import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, comparePassword } from '../common/utils/hash.util';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Public methods ──────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const customerRole = await this.prisma.role.findUniqueOrThrow({
      where: { name: 'CUSTOMER' },
      select: { id: true },
    });

    const hashed = await hashPassword(dto.password);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashed,
          firstName: dto.firstName,
          lastName: dto.lastName,
          roles: { create: { roleId: customerRole.id } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatar: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }

    const tokens = await this.generateTokens(user.id, user.email);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return { user, ...tokens };
  }

  async login(validatedUser: { id: string; email: string }) {
    const tokens = await this.generateTokens(
      validatedUser.id,
      validatedUser.email,
    );
    await this.storeRefreshToken(validatedUser.id, tokens.refreshToken);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: validatedUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    return { user, ...tokens };
  }

  async refreshTokens(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isActive: true, refreshToken: true },
    });

    if (!user || !user.isActive || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    const hashedInputToken = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    const tokenMatches = user.refreshToken === hashedInputToken;
    if (!tokenMatches) {
      throw new UnauthorizedException('Refresh token is invalid');
    }

    const tokens = await this.generateTokens(user.id, user.email);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true },
    });
    // Always return silently to prevent email enumeration
    if (!user || !user.isActive) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // TODO: Queue password-reset email with rawToken once MailModule is implemented
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const hashed = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordResetToken: null,
        passwordResetExpires: null,
        refreshToken: null, // invalidate all active sessions
      },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, password: true },
    });

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashed = await hashPassword(newPassword);

    const tokens = await this.generateTokens(userId, user.email);
    const hashedRefreshToken = crypto
      .createHash('sha256')
      .update(tokens.refreshToken)
      .digest('hex');

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, refreshToken: hashedRefreshToken },
    });

    return tokens;
  }

  /**
   * Validates a user for administrative access.
   * Returns user without sensitive fields, or null on failure/insufficient privileges.
   */
  async validateAdminUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) return null;

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) return null;

    // Fetch full roles and permissions for the validation response
    const { roles, permissions } = await this.fetchRolesAndPermissions(user.id);

    // General admin check: must have either ADMIN or SUPER_ADMIN role
    const hasPrivileges = roles.some((role) =>
      ['ADMIN', 'SUPER_ADMIN'].includes(role),
    );

    if (!hasPrivileges) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pwd, roles: _roles, ...result } = user;
    return { ...result, roles, permissions };
  }

  /**
   * Validates a user specifically for Dashboard access.
   * Requires 'manage:all' or 'read:analytics' permission.
   */
  async validateDashboardUser(email: string, password: string) {
    const user = await this.validateAdminUser(email, password);
    if (!user) return null;

    // Specifically check for dashboard-level permissions
    const canAccessDashboard =
      user.permissions.includes('manage:all') ||
      user.permissions.includes('read:analytics');

    if (!canAccessDashboard) {
      return null;
    }

    return user;
  }

  /** Used by LocalStrategy — returns user without sensitive fields, or null on failure. */
  async validateUser(email: string, password: string) {
    // Standard login for privileged users
    return this.validateAdminUser(email, password);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async generateTokens(userId: string, email: string) {
    const { roles, permissions } = await this.fetchRolesAndPermissions(userId);
    const payload: JwtPayload = { sub: userId, email, roles, permissions };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRATION',
          '7d',
        ) as StringValue,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const hashed = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });
  }

  private async fetchRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissionsSet = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.permissions) {
        permissionsSet.add(`${rp.permission.action}:${rp.permission.subject}`);
      }
    }

    return { roles, permissions: Array.from(permissionsSet) };
  }
}
