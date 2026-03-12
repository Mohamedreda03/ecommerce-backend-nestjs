# =============================================================================
# Multi-stage Dockerfile
# Stage 1 (deps)    — Install production-only node_modules
# Stage 2 (builder) — Install all deps + compile TypeScript
# Stage 3 (production) — Lean final image with compiled output only
# =============================================================================

# ---- Stage 1: Production dependencies ----
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./

# Install only production dependencies (no devDependencies)
RUN npm ci --omit=dev && npm cache clean --force


# ---- Stage 2: Builder (compile TypeScript) ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install ALL dependencies (including devDependencies for the build)
RUN npm ci

# Copy source code and project config
COPY . .

# Generate Prisma client BEFORE building (required by NestJS decorators)
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npm run build


# ---- Stage 3: Production image ----
FROM node:22-alpine AS production

WORKDIR /app

# Create a non-root user/group for security
RUN addgroup -g 1001 -S nodejs \
 && adduser -S nestjs -u 1001 -G nodejs

# Copy production node_modules from Stage 1
COPY --from=deps    --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copy compiled dist from Stage 2
COPY --from=builder --chown=nestjs:nodejs /app/dist          ./dist

# Copy Prisma schema & generated client (needed at runtime)
COPY --from=builder --chown=nestjs:nodejs /app/prisma        ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Copy package files (used by NestJS for package resolution)
COPY --chown=nestjs:nodejs package*.json ./

# Create uploads directory with correct permissions
RUN mkdir -p /app/uploads && chown nestjs:nodejs /app/uploads

# Switch to non-root user
USER nestjs

# Expose application port
EXPOSE 3000

# Health check — container is healthy once the API responds
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Entrypoint: run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
