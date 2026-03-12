import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as hashUtil from '../common/utils/hash.util';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  role: {
    findUniqueOrThrow: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
};

const mockJwtService = {
  signAsync: jest.fn(),
  verify: jest.fn(),
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
    };
    return map[key] ?? '';
  }),
  get: jest.fn((key: string, fallback: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_EXPIRATION: '15m',
      JWT_REFRESH_EXPIRATION: '7d',
    };
    return map[key] ?? fallback;
  }),
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: JwtService, useValue: mockJwtService },
      { provide: ConfigService, useValue: mockConfigService },
    ],
  }).compile();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get<AuthService>(AuthService);

    // Default role + permission stubs
    mockPrisma.role.findUniqueOrThrow.mockResolvedValue({ id: 'role-id' });
    mockPrisma.userRole.findMany.mockResolvedValue([
      {
        role: {
          name: 'CUSTOMER',
          permissions: [{ permission: { action: 'read', subject: 'product' } }],
        },
      },
    ]);
    mockJwtService.signAsync.mockResolvedValue('signed-token');
  });

  // ─── register ───────────────────────────────────────────────────────────────

  describe('register', () => {
    const dto = {
      email: 'new@example.com',
      password: 'Pass@1234',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('creates user, assigns CUSTOMER role, and returns tokens + user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-id',
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: null,
        avatar: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.register(dto);

      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(dto.email);
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ─── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns tokens and user on successful login', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: null,
        avatar: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        roles: [{ role: { name: 'CUSTOMER' } }],
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.login({
        id: 'user-id',
        email: 'user@example.com',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.id).toBe('user-id');
    });
  });

  // ─── refreshTokens ──────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('returns new token pair on valid refresh token', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-id',
        email: 'user@example.com',
        roles: ['CUSTOMER'],
        permissions: ['read:product'],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        isActive: true,
        refreshToken: 'stored-hash',
      });
      jest.spyOn(hashUtil, 'comparePassword').mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.refreshTokens('valid-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('throws UnauthorizedException when JWT verify fails', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshTokens('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when stored hash does not match', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'user-id',
        email: 'e@e.com',
        roles: [],
        permissions: [],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        isActive: true,
        refreshToken: 'hashed',
      });
      jest.spyOn(hashUtil, 'comparePassword').mockResolvedValue(false);

      await expect(service.refreshTokens('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('nullifies the refresh token in DB', async () => {
      mockPrisma.user.update.mockResolvedValue({});

      await service.logout('user-id');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { refreshToken: null },
      });
    });
  });

  // ─── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('stores hashed reset token when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        isActive: true,
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.forgotPassword('user@example.com');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id' },
          data: expect.objectContaining({
            passwordResetToken: expect.any(String),
            passwordResetExpires: expect.any(Date),
          }),
        }),
      );
    });

    it('returns silently when email does not exist (prevent enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword('ghost@example.com'),
      ).resolves.toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ─── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('updates password and clears reset fields when token is valid', async () => {
      const rawToken = 'raw-reset-token';
      const hashedToken = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-id' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.resetPassword(rawToken, 'NewPass@123');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ passwordResetToken: hashedToken }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordResetToken: null,
            passwordResetExpires: null,
          }),
        }),
      );
    });

    it('throws BadRequestException when token is invalid/expired', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'Pass@1234'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('returns user without password on valid credentials', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'user@example.com',
        password: 'hashed',
        isActive: true,
        deletedAt: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(hashUtil, 'comparePassword').mockResolvedValue(true);

      const result = await service.validateUser('user@example.com', 'Pass@1');

      expect(result).not.toHaveProperty('password');
      expect(result?.id).toBe('user-id');
    });

    it('returns null when password does not match', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        password: 'hashed',
        isActive: true,
      });
      jest.spyOn(hashUtil, 'comparePassword').mockResolvedValue(false);

      const result = await service.validateUser('user@example.com', 'wrong');
      expect(result).toBeNull();
    });

    it('returns null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.validateUser('ghost@example.com', 'pass');
      expect(result).toBeNull();
    });

    it('returns null when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        isActive: false,
        password: 'hashed',
      });
      const result = await service.validateUser('user@example.com', 'pass');
      expect(result).toBeNull();
    });
  });
});
