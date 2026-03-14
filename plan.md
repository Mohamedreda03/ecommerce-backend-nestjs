# E-Commerce Backend — NestJS Master Plan

> **Stack:** NestJS 11 · Prisma · PostgreSQL · Redis · Passport (JWT) · Stripe · Nodemailer · Swagger
> **Architecture:** Modular clean architecture with global filters, guards, interceptors, RBAC with granular permissions, idempotency pattern for checkout, optimistic stock locking.
> **Store type:** Single-vendor online store (not multi-vendor).

---

## Target Directory Structure

```
src/
├── common/
│   ├── constants/            # App-wide constants (roles, permissions, error codes)
│   ├── decorators/           # @Public, @Permissions, @CurrentUser, @IdempotencyKey
│   ├── dto/                  # PaginationQueryDto, ApiResponseDto
│   ├── enums/                # OrderStatus, PaymentStatus, DiscountType, etc.
│   ├── filters/              # GlobalExceptionFilter (Prisma-aware), HttpExceptionFilter
│   ├── guards/               # JwtAuthGuard (global), PermissionsGuard, ThrottlerBehindProxyGuard
│   ├── interceptors/         # TransformInterceptor, LoggingInterceptor, TimeoutInterceptor
│   ├── middleware/            # IdempotencyMiddleware, CorrelationIdMiddleware
│   ├── pipes/                # N/A (use built-in ValidationPipe globally)
│   └── utils/                # slugify(), hashPassword(), generateSku(), pagination helpers
├── config/                   # ConfigModule + env validation with Joi
├── prisma/                   # PrismaModule, PrismaService (lifecycle-aware), PrismaHealthIndicator
├── redis/                    # RedisModule wrapping ioredis for caching + idempotency
├── auth/                     # Login, register, refresh, logout, password reset; Passport strategies
├── users/                    # CRUD, profile, avatar upload, soft-delete
├── roles/                    # Role CRUD, permission assignment, seeding
├── categories/               # CRUD, tree structure (parentId), slug auto-gen
├── products/                 # CRUD, image upload, stock management, soft-delete, search/filter
├── cart/                     # Per-user cart, add/remove/update quantity, clear
├── addresses/                # CRUD, mark default, SHIPPING/BILLING types
├── orders/                   # Checkout flow (idempotent), order history, status transitions, admin list
├── payments/                 # Stripe integration, create PaymentIntent, webhook handler
├── reviews/                  # Create, approve/reject (admin), list by product
├── wishlist/                 # Add/remove/list
├── coupons/                  # CRUD, validate, apply to order, usage tracking
├── mail/                     # Bull queue + Nodemailer, email templates (order confirm, password reset)
├── files/                    # MulterModule, local disk upload, serve static
├── health/                   # @nestjs/terminus health checks (DB, Redis, disk)
├── app.module.ts
├── app.controller.ts
├── app.service.ts
└── main.ts
```

---

## Phase 1 — Foundation & Infrastructure Setup

### Step 1.1: Install core dependencies

- [x] **Task:** Install all required packages in a single command.

  ```
  Dependencies:
    @nestjs/config, @nestjs/swagger, @nestjs/throttler, @nestjs/terminus,
    @nestjs/passport, @nestjs/jwt, passport, passport-jwt, passport-local,
    @prisma/client, class-validator, class-transformer,
    bcrypt, helmet, cookie-parser, compression,
    ioredis, @nestjs/bull, bull, nodemailer,
    stripe, multer, uuid, slugify, joi

  DevDependencies:
    prisma, @types/passport-jwt, @types/passport-local,
    @types/bcrypt, @types/multer, @types/nodemailer,
    @types/cookie-parser, @types/compression, @types/uuid
  ```

  > **Note:** Use exact compatible versions. Do NOT install `@nestjs/cache-manager` — we will use raw `ioredis` wrapped in a custom module for more control. For Bull, use `@nestjs/bull` + `bull` (not BullMQ) for simplicity with NestJS 11 compatibility.

### Step 1.2: Environment configuration

- [x] **Task:** Create `.env` and `.env.example` files at the project root.
  ```
  Required variables:
    NODE_ENV=development
    PORT=3000
    DATABASE_URL=postgresql://user:password@localhost:5432/ecommerce?schema=public
    JWT_ACCESS_SECRET=<random-64-char>
    JWT_REFRESH_SECRET=<random-64-char>
    JWT_ACCESS_EXPIRATION=15m
    JWT_REFRESH_EXPIRATION=7d
    REDIS_HOST=localhost
    REDIS_PORT=6379
    STRIPE_SECRET_KEY=sk_test_xxx
    STRIPE_WEBHOOK_SECRET=whsec_xxx
    MAIL_HOST=smtp.gmail.com
    MAIL_PORT=587
    MAIL_USER=
    MAIL_PASSWORD=
    MAIL_FROM=noreply@ecommerce.com
    UPLOAD_DIR=./uploads
    FRONTEND_URL=http://localhost:3001
  ```
- [x] **Task:** Create `src/config/config.module.ts` — import `ConfigModule.forRoot()` with `isGlobal: true` and Joi validation schema.
- [x] **Task:** Create `src/config/env.validation.ts` — Joi schema that validates every env var at startup. App MUST fail to start if any required var is missing.
  > **Note:** Every env var must have a Joi validation rule. Use `.required()` for production-critical vars, `.default()` for dev-safe fallbacks. The ConfigModule must be the very first import in AppModule.

### Step 1.3: Prisma setup

- [x] **Task:** Run `npx prisma init` to create `prisma/` directory with `schema.prisma`.
- [x] **Task:** Create `src/prisma/prisma.module.ts` — Global module that exports `PrismaService`.
- [x] **Task:** Create `src/prisma/prisma.service.ts` — Extends `PrismaClient`, implements `OnModuleInit` and `OnModuleDestroy`. In `onModuleInit()`, call `this.$connect()`. In `onModuleDestroy()`, call `this.$disconnect()`. Enable query logging in development mode.
  > **Note:** Mark `PrismaModule` as `@Global()` so every module can inject `PrismaService` without importing PrismaModule. The service must handle graceful shutdown.
- [x] **Test:** Write a unit test for `PrismaService` — verify `$connect` is called on init.

### Step 1.4: Redis module

- [x] **Task:** Create `src/redis/redis.module.ts` — Global module providing an `ioredis` client via a custom provider (injection token `REDIS_CLIENT`).
- [x] **Task:** Create `src/redis/redis.service.ts` — Wraps `ioredis` client. Methods: `get(key)`, `set(key, value, ttlSeconds?)`, `del(key)`, `exists(key)`, `setNX(key, value, ttlSeconds)` (for idempotency). Implements `OnModuleDestroy` to call `quit()`.
  > **Note:** `setNX` = SET if Not eXists — crucial for the idempotency lock. Must be atomic. Use the Redis `SET key value EX ttl NX` command.
- [x] **Test:** Write unit tests for `RedisService` with mocked ioredis client.

### Step 1.5: Global exception filter (Prisma-aware)

- [x] **Task:** Create `src/common/filters/global-exception.filter.ts`.
  - Implement `ExceptionFilter` catching `all` exceptions.
  - Specifically handle:
    - `HttpException` → forward status & message.
    - `Prisma.PrismaClientKnownRequestError`:
      - `P2002` (unique constraint) → `409 Conflict` with field name in message.
      - `P2025` (record not found) → `404 Not Found`.
      - `P2003` (foreign key constraint) → `400 Bad Request` with relation info.
      - `P2028` (transaction timed out) → `503 Service Unavailable`.
    - `Prisma.PrismaClientValidationError` → `400 Bad Request`.
    - `ThrottlerException` → `429 Too Many Requests`.
    - Unknown errors → `500 Internal Server Error`, log full stack, return generic message (never leak internals).
  - Response shape: `{ statusCode, message, error, timestamp, path }`.
    > **Note:** This is critical. By catching Prisma errors globally, we avoid race conditions silently failing. For example, two concurrent checkouts creating duplicate orders will hit P2002 on the idempotency key and return 409 instead of crashing. NEVER expose raw Prisma error messages to clients in production.
- [x] **Test:** Write unit tests for the filter — mock each Prisma error code and verify correct HTTP status and message.

### Step 1.6: Global interceptors & pipes

- [x] **Task:** Create `src/common/interceptors/transform.interceptor.ts` — Wraps all responses in a consistent envelope: `{ success: true, data: <response>, timestamp }`. Exclude Swagger endpoints from transformation.
- [x] **Task:** Create `src/common/interceptors/logging.interceptor.ts` — Logs method, URL, status code, and response time (ms) for every request. Use NestJS `Logger`.
- [x] **Task:** Create `src/common/interceptors/timeout.interceptor.ts` — Applies a 30-second timeout to all requests using RxJS `timeout` operator. Throws `RequestTimeoutException` on expiry.
- [x] **Task:** Create `src/common/middleware/correlation-id.middleware.ts` — Generates a UUID `X-Correlation-ID` header if not present, attaches to request and response. Useful for tracing.
  > **Note:** All interceptors and the middleware should be registered globally in `main.ts` or `AppModule`. The `ValidationPipe` should also be set globally in `main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.

### Step 1.7: Bootstrap `main.ts`

- [x] **Task:** Update `src/main.ts` to:
  1. Enable `helmet()` for security headers.
  2. Enable `compression()`.
  3. Enable `cookieParser()`.
  4. Enable CORS with `FRONTEND_URL` from env.
  5. Set global prefix `api/v1`.
  6. Set global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`.
  7. Set global `GlobalExceptionFilter`.
  8. Set global `TransformInterceptor`, `LoggingInterceptor`, `TimeoutInterceptor`.
  9. Apply `CorrelationIdMiddleware` globally.
  10. Configure Swagger with `DocumentBuilder` — title, description, version, bearer auth.
  11. Serve Swagger at `api/docs`.
  12. Enable shutdown hooks (`app.enableShutdownHooks()`).
  13. Listen on `PORT` from config.
      > **Note:** Order matters. Filters run last (catch), interceptors wrap around, middleware runs first. Keep that in mind.

### Step 1.8: Shared DTOs and utilities

- [x] **Task:** Create `src/common/dto/pagination-query.dto.ts` — `page` (default 1), `limit` (default 20, max 100), `sortBy` (optional), `sortOrder` ('asc'|'desc'). All validated with class-validator.
- [x] **Task:** Create `src/common/dto/paginated-response.dto.ts` — Generic response: `{ data: T[], meta: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`.
- [x] **Task:** Create `src/common/utils/slug.util.ts` — Function that generates URL-safe slugs from strings. If slug exists in DB, append `-2`, `-3`, etc.
- [x] **Task:** Create `src/common/utils/hash.util.ts` — `hashPassword(plain)` and `comparePassword(plain, hash)` using bcrypt with salt rounds 12.
- [x] **Task:** Create `src/common/enums/` — `order-status.enum.ts` (PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED), `payment-status.enum.ts` (PENDING, SUCCEEDED, FAILED, REFUNDED), `discount-type.enum.ts` (PERCENTAGE, FIXED_AMOUNT), `address-type.enum.ts` (SHIPPING, BILLING).
- [x] **Test:** Write unit tests for slug utility and hash utility.

### Step 1.9: Custom decorators

- [x] **Task:** Create `src/common/decorators/public.decorator.ts` — `@Public()` sets metadata `isPublic: true`. Used to bypass JWT guard on specific routes.
- [x] **Task:** Create `src/common/decorators/permissions.decorator.ts` — `@Permissions('create:product', 'read:product')` sets required permissions metadata.
- [x] **Task:** Create `src/common/decorators/current-user.decorator.ts` — `@CurrentUser()` extracts user from `request.user`, typed properly.
  > **Note:** `@CurrentUser()` should accept an optional `data` string param to return a specific field (e.g., `@CurrentUser('id')`).
- [x] **Test:** Verify decorators set correct metadata using `Reflect.getMetadata()`.

---

## Phase 2 — Database Schema (Prisma)

### Step 2.1: Design and write the full Prisma schema

- [x] **Task:** Write `prisma/schema.prisma` with ALL models. This is a single-step atomic task.

  **Models to define:**

  **User**
  - `id` (String, UUID, @default(uuid()))
  - `email` (String, @unique)
  - `password` (String)
  - `firstName` (String)
  - `lastName` (String)
  - `phone` (String?, @unique — nullable)
  - `avatar` (String? — file path)
  - `isActive` (Boolean, @default(true))
  - `refreshToken` (String? — hashed refresh token)
  - `passwordResetToken` (String?)
  - `passwordResetExpires` (DateTime?)
  - `createdAt` (DateTime, @default(now()))
  - `updatedAt` (DateTime, @updatedAt)
  - `deletedAt` (DateTime? — soft delete)
  - Relations: roles (UserRole[]), addresses (Address[]), orders (Order[]), reviews (Review[]), cart (Cart?), wishlistItems (WishlistItem[])

  **Role**
  - `id` (String, UUID)
  - `name` (String, @unique) — e.g., "SUPER_ADMIN", "ADMIN", "CUSTOMER"
  - `description` (String?)
  - `createdAt`, `updatedAt`
  - Relations: users (UserRole[]), permissions (RolePermission[])

  **Permission**
  - `id` (String, UUID)
  - `action` (String) — e.g., "create", "read", "update", "delete", "manage"
  - `subject` (String) — e.g., "product", "order", "user", "all"
  - `description` (String?)
  - `createdAt`, `updatedAt`
  - Relations: roles (RolePermission[])
  - `@@unique([action, subject])` — prevent duplicate permission definitions

  **UserRole** (join table)
  - `userId`, `roleId` — composite PK
  - `assignedAt` (DateTime, @default(now()))
  - Relations: user, role

  **RolePermission** (join table)
  - `roleId`, `permissionId` — composite PK
  - `assignedAt` (DateTime, @default(now()))
  - Relations: role, permission

  **Address**
  - `id` (String, UUID)
  - `userId` (String)
  - `type` (AddressType enum: SHIPPING, BILLING)
  - `firstName`, `lastName` (String)
  - `street` (String)
  - `city` (String)
  - `state` (String)
  - `country` (String)
  - `zipCode` (String)
  - `phone` (String?)
  - `isDefault` (Boolean, @default(false))
  - `createdAt`, `updatedAt`
  - Relation: user

  **Category**
  - `id` (String, UUID)
  - `name` (String)
  - `slug` (String, @unique)
  - `description` (String?)
  - `image` (String?)
  - `parentId` (String? — self-relation for tree)
  - `isActive` (Boolean, @default(true))
  - `sortOrder` (Int, @default(0))
  - `createdAt`, `updatedAt`
  - Relations: parent (Category?), children (Category[]), products (Product[])

  **Product**
  - `id` (String, UUID)
  - `name` (String)
  - `slug` (String, @unique)
  - `description` (String?)
  - `shortDescription` (String?)
  - `price` (Decimal — use Prisma Decimal for money)
  - `compareAtPrice` (Decimal? — original price for "on sale" display)
  - `costPrice` (Decimal? — for profit calculation, never exposed to client)
  - `sku` (String, @unique)
  - `stock` (Int, @default(0))
  - `lowStockThreshold` (Int, @default(5))
  - `weight` (Decimal? — for shipping calculation)
  - `isActive` (Boolean, @default(true))
  - `isFeatured` (Boolean, @default(false))
  - `categoryId` (String)
  - `createdAt`, `updatedAt`
  - `deletedAt` (DateTime? — soft delete)
  - Relations: category, images (ProductImage[]), cartItems (CartItem[]), orderItems (OrderItem[]), reviews (Review[]), wishlistItems (WishlistItem[])
  - Indexes: `@@index([categoryId])`, `@@index([slug])`, `@@index([isActive, isFeatured])`, `@@index([price])`

  **ProductImage**
  - `id` (String, UUID)
  - `productId` (String)
  - `url` (String)
  - `alt` (String?)
  - `sortOrder` (Int, @default(0))
  - `createdAt`
  - Relation: product

  **Cart**
  - `id` (String, UUID)
  - `userId` (String, @unique — one cart per user)
  - `createdAt`, `updatedAt`
  - Relations: user, items (CartItem[])

  **CartItem**
  - `id` (String, UUID)
  - `cartId` (String)
  - `productId` (String)
  - `quantity` (Int)
  - `createdAt`, `updatedAt`
  - Relations: cart, product
  - `@@unique([cartId, productId])` — one entry per product per cart

  **Order**
  - `id` (String, UUID)
  - `orderNumber` (String, @unique — human-readable, auto-generated, e.g., "ORD-20260312-XXXX")
  - `userId` (String)
  - `status` (OrderStatus enum: PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED)
  - `subtotalAmount` (Decimal)
  - `shippingAmount` (Decimal, @default(0))
  - `taxAmount` (Decimal, @default(0))
  - `discountAmount` (Decimal, @default(0))
  - `totalAmount` (Decimal)
  - `shippingAddressSnapshot` (Json — snapshot of address at order time, so if address changes later, order keeps original)
  - `billingAddressSnapshot` (Json?)
  - `couponId` (String?)
  - `idempotencyKey` (String, @unique — prevents duplicate order creation on double-click)
  - `notes` (String?)
  - `shippedAt` (DateTime?)
  - `deliveredAt` (DateTime?)
  - `cancelledAt` (DateTime?)
  - `createdAt`, `updatedAt`
  - Relations: user, items (OrderItem[]), payment (Payment?), coupon (Coupon?)
  - Indexes: `@@index([userId])`, `@@index([status])`, `@@index([orderNumber])`

  **OrderItem**
  - `id` (String, UUID)
  - `orderId` (String)
  - `productId` (String)
  - `productName` (String — snapshot)
  - `productSku` (String — snapshot)
  - `quantity` (Int)
  - `unitPrice` (Decimal)
  - `totalPrice` (Decimal)
  - `createdAt`
  - Relations: order, product

  **Payment**
  - `id` (String, UUID)
  - `orderId` (String, @unique — one payment per order)
  - `stripePaymentIntentId` (String, @unique)
  - `amount` (Decimal)
  - `currency` (String, @default("usd"))
  - `status` (PaymentStatus enum: PENDING, SUCCEEDED, FAILED, REFUNDED)
  - `stripeResponse` (Json? — store raw Stripe response for debugging)
  - `createdAt`, `updatedAt`
  - Relation: order

  **Review**
  - `id` (String, UUID)
  - `userId` (String)
  - `productId` (String)
  - `rating` (Int — 1-5, validated at app level)
  - `title` (String?)
  - `comment` (String?)
  - `isApproved` (Boolean, @default(false))
  - `createdAt`, `updatedAt`
  - Relations: user, product
  - `@@unique([userId, productId])` — one review per user per product

  **WishlistItem**
  - `id` (String, UUID)
  - `userId` (String)
  - `productId` (String)
  - `createdAt`
  - Relations: user, product
  - `@@unique([userId, productId])`

  **Coupon**
  - `id` (String, UUID)
  - `code` (String, @unique)
  - `description` (String?)
  - `discountType` (DiscountType enum: PERCENTAGE, FIXED_AMOUNT)
  - `discountValue` (Decimal)
  - `minOrderAmount` (Decimal?)
  - `maxDiscountAmount` (Decimal? — cap for percentage discounts)
  - `maxUses` (Int?)
  - `currentUses` (Int, @default(0))
  - `isActive` (Boolean, @default(true))
  - `startsAt` (DateTime?)
  - `expiresAt` (DateTime?)
  - `createdAt`, `updatedAt`
  - Relations: orders (Order[])

  > **CRITICAL NOTES for the AI implementing this step:**
  >
  > - Use `Decimal` for ALL money fields — never use `Float`.
  > - Use `@@map` to set snake_case table names (e.g., `@@map("users")`).
  > - Use `@map` for snake_case column names if desired (e.g., `firstName @map("first_name")`).
  > - Define all enums as Prisma `enum` types at the top of the schema.
  > - Add `@@index` on all foreign keys and commonly queried fields.
  > - Enable `previewFeatures = ["fullTextSearch"]` in the generator for product search.

### Step 2.2: Create initial migration and seed file

- [x] **Task:** Run `npx prisma migrate dev --name init` to create the initial migration.
- [x] **Task:** Create `prisma/seed.ts`:
  1. Create permissions: Full CRUD for each subject (product, category, order, user, review, coupon, analytics, role).
  2. Create "manage:all" super permission.
  3. Create roles: SUPER_ADMIN (gets "manage:all"), ADMIN (gets everything except user management), CUSTOMER (gets read:product, create:order, create:review, read:order-own, manage:cart, manage:wishlist, manage:address).
  4. Create a default super admin user (email: admin@ecommerce.com, password: hashed "Admin@123").
  5. Create sample categories and products for development.
     > **Note:** The seed file must be idempotent — use `upsert` for everything so running it multiple times is safe. Add this to `package.json`: `"prisma": { "seed": "ts-node prisma/seed.ts" }`.
- [x] **Task:** Run `npx prisma db seed` to verify seeding works.
- [x] **Test:** Verify seeded data exists by running a simple Prisma query in a test.

---

## Phase 3 — Authentication & Authorization

### Step 3.1: Auth module structure

- [x] **Task:** Create the auth module with the following files:
  - `src/auth/auth.module.ts`
  - `src/auth/auth.controller.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/dto/register.dto.ts` (email, password w/ strong validation: min 8 chars + upper + lower + number + special, firstName, lastName)
  - `src/auth/dto/login.dto.ts` (email, password)
  - `src/auth/dto/refresh-token.dto.ts` (refreshToken)
  - `src/auth/dto/reset-password.dto.ts` (token, newPassword)
  - `src/auth/dto/forgot-password.dto.ts` (email)
  - `src/auth/dto/change-password.dto.ts` (currentPassword, newPassword)

### Step 3.2: Passport strategies

- [x] **Task:** Create `src/auth/strategies/local.strategy.ts` — `LocalStrategy` extending `PassportStrategy(Strategy)` from `passport-local`. Validates email+password, returns user or throws `UnauthorizedException`.
- [x] **Task:** Create `src/auth/strategies/jwt.strategy.ts` — `JwtStrategy` extracting token from Authorization Bearer header. Validates user exists and is active. Returns user payload `{ id, email, roles, permissions }`.
- [x] **Task:** Create `src/auth/strategies/jwt-refresh.strategy.ts` — `JwtRefreshStrategy` extracting refresh token. Validates token matches stored hash. Returns user payload.
  > **Note:** Access token payload should contain `{ sub: userId, email, roles: string[], permissions: string[] }`. Permissions format: `"action:subject"` (e.g., `"create:product"`). Store permissions in token to avoid DB lookup on every request.

### Step 3.3: Auth guards

- [x] **Task:** Create `src/common/guards/jwt-auth.guard.ts` — Extends `AuthGuard('jwt')`. Overrides `canActivate()` to check `@Public()` metadata — if present, allow access without token. This guard is applied globally.
- [x] **Task:** Create `src/common/guards/permissions.guard.ts` — Reads `@Permissions()` metadata, extracts user permissions from `request.user`, checks if user has ALL required permissions. Users with `"manage:all"` bypass all checks.
  > **Note:** `JwtAuthGuard` must be registered as a global guard using `APP_GUARD` provider in `AuthModule`. `PermissionsGuard` is also registered globally but only activates when `@Permissions()` is present on a handler.

### Step 3.4: Auth service implementation

- [x] **Task:** Implement `AuthService` methods:
  1. `register(dto)` — Hash password, create user via Prisma, assign "CUSTOMER" role, generate tokens, return tokens + user (excluding password).
  2. `login(user)` — Generate access + refresh tokens. Hash refresh token and store in user record. Return tokens.
  3. `refreshTokens(userId, refreshToken)` — Verify refresh token against stored hash. Generate new token pair. Update stored hash (token rotation). Return new tokens.
  4. `logout(userId)` — Set `refreshToken` to `null` in DB (invalidate).
  5. `forgotPassword(email)` — Generate crypto-random token, hash and store in user record with 1-hour expiry. Queue email (don't send synchronously). Return success (even if email not found — prevent enumeration).
  6. `resetPassword(token, newPassword)` — Find user by unhashed token + valid expiry. Update password, clear reset fields.
  7. `changePassword(userId, currentPassword, newPassword)` — Verify current, update to new.
  8. `validateUser(email, password)` — Find user, compare password, return user or null.
  9. `generateTokens(user)` — Private helper: create access token (15min) + refresh token (7d) using JwtService.
     > **Note:** NEVER return the password field in any response. Use Prisma `select` to exclude it, or use class-transformer `@Exclude()`. Token rotation on refresh is critical: old refresh token becomes invalid immediately.

### Step 3.5: Auth controller endpoints

### Step 3.5: Auth controller endpoints

- [x] **Task:** Implement `AuthController`:
  - `POST /auth/register` — `@Public()`, body: RegisterDto → `{ user, accessToken, refreshToken }`
  - `POST /auth/login` — `@Public()`, `@UseGuards(LocalAuthGuard)`, body: LoginDto → `{ user, accessToken, refreshToken }`
  - `POST /auth/refresh` — `@Public()`, body: RefreshTokenDto → `{ accessToken, refreshToken }`
  - `POST /auth/logout` — Authenticated → `{ message: 'Logged out successfully' }`
  - `POST /auth/forgot-password` — `@Public()`, body: ForgotPasswordDto → `{ message: 'If email exists, reset link sent' }`
  - `POST /auth/reset-password` — `@Public()`, body: ResetPasswordDto → `{ message: 'Password reset successfully' }`
  - `POST /auth/change-password` — Authenticated, body: ChangePasswordDto → `{ message: 'Password changed' }`
  - `GET /auth/me` — Authenticated → returns current user profile with roles & permissions
- [x] **Test:** Write unit tests for `AuthService` (mock PrismaService, JwtService):
  - Test registration creates user and assigns CUSTOMER role.
  - Test login returns tokens.
  - Test refresh rotates tokens.
  - Test logout nullifies refresh token.
  - Test password reset flow.
  - Test invalid credentials throw `UnauthorizedException`.
- [x] **Test:** Write integration tests for `AuthController` endpoints:
  - Full registration → login → access protected route → refresh → logout flow.
  - Duplicate email registration returns 409.
  - Invalid token returns 401.

---

## Phase 4 — User Management

### Step 4.1: Users module

- [x] **Task:** Create `src/users/users.module.ts`, `users.controller.ts`, `users.service.ts`.
- [x] **Task:** Create DTOs: `create-user.dto.ts`, `update-user.dto.ts` (PartialType of create), `update-profile.dto.ts`, `user-response.dto.ts` (with `@Exclude()` on password, refreshToken fields).

### Step 4.2: Users service

- [x] **Task:** Implement `UsersService`:
  - `findAll(paginationDto)` — Paginated, exclude soft-deleted, exclude password. Admin only.
  - `findById(id)` — Exclude password. Throw `NotFoundException` if not found or soft-deleted.
  - `findByEmail(email)` — Include password (internal use only, for auth). Throw if soft-deleted.
  - `create(dto)` — Admin-only user creation (with optional role assignment).
  - `updateProfile(userId, dto)` — User updates their own profile (name, phone, avatar only).
  - `update(id, dto)` — Admin updates any user (including isActive, roles).
  - `softDelete(id)` — Set `deletedAt` timestamp. Prevent deleting self. Admin only.
  - `restore(id)` — Clear `deletedAt`. Admin only.
    > **Note:** All "find" methods must filter out `deletedAt IS NOT NULL` by default. Use a Prisma middleware or add `where: { deletedAt: null }` consistently.

### Step 4.3: Users controller

- [x] **Task:** Implement `UsersController` with proper `@Permissions()`:
  - `GET /users` — `@Permissions('read:user')` → paginated list
  - `GET /users/:id` — `@Permissions('read:user')` → single user
  - `POST /users` — `@Permissions('create:user')` → create
  - `PATCH /users/profile` — Any authenticated user → update own profile
  - `PATCH /users/:id` — `@Permissions('update:user')` → admin update
  - `DELETE /users/:id` — `@Permissions('delete:user')` → soft delete
  - `PATCH /users/:id/restore` — `@Permissions('update:user')` → restore
- [x] **Test:** Unit tests for `UsersService` — CRUD operations, soft delete, pagination.
- [x] **Test:** Integration test — admin creates user, lists, updates, soft-deletes, customer cannot access admin endpoints.

---

## Phase 5 — Role & Permission Management

### Step 5.1: Roles module

- [x] **Task:** Create `src/roles/roles.module.ts`, `roles.controller.ts`, `roles.service.ts`.
- [x] **Task:** Create DTOs: `create-role.dto.ts` (name, description, permissionIds[]), `update-role.dto.ts`, `assign-role.dto.ts` (userId, roleId).

### Step 5.2: Roles service

- [x] **Task:** Implement `RolesService`:
  - `findAll()` — List all roles with their permissions.
  - `findById(id)` — Single role with permissions.
  - `create(dto)` — Create role and associate permissions in a transaction.
  - `update(id, dto)` — Update role name/description AND re-assign permissions (delete old, create new) in a transaction.
  - `delete(id)` — Prevent deleting "SUPER_ADMIN", "ADMIN", "CUSTOMER" built-in roles. Delete only custom roles.
  - `assignRoleToUser(userId, roleId)` — Create UserRole record.
  - `removeRoleFromUser(userId, roleId)` — Delete UserRole record. Prevent removing last role.
  - `getAllPermissions()` — List all available permissions.
    > **Note:** When roles change, the user's JWT still holds old permissions until it expires (15min max). This is acceptable. For immediate revocation, you'd need a token blacklist — out of scope unless requested.

### Step 5.3: Roles controller

- [x] **Task:** Implement `RolesController`:
  - `GET /roles` — `@Permissions('read:role')` → list all
  - `GET /roles/:id` — `@Permissions('read:role')` → single
  - `POST /roles` — `@Permissions('create:role')` → create
  - `PATCH /roles/:id` — `@Permissions('update:role')` → update
  - `DELETE /roles/:id` — `@Permissions('delete:role')` → delete (non-built-in only)
  - `POST /roles/assign` — `@Permissions('update:user')` → assign role to user
  - `POST /roles/revoke` — `@Permissions('update:user')` → remove role from user
  - `GET /permissions` — `@Permissions('read:role')` → list all permissions
- [x] **Test:** Unit tests for role CRUD, permission assignment, built-in role protection. Integration test for full role lifecycle.

---

## Phase 6 — Category Management

### Step 6.1: Categories module

- [x] **Task:** Create `src/categories/categories.module.ts`, `categories.controller.ts`, `categories.service.ts`.
- [x] **Task:** Create DTOs: `create-category.dto.ts` (name, description?, parentId?, image?, sortOrder?), `update-category.dto.ts`.

### Step 6.2: Categories service

- [x] **Task:** Implement `CategoriesService`:
  - `findAll(includeInactive?)` — Return flat list with parent info. Admins see inactive, public sees active only.
  - `findTree()` — Return nested tree structure (recursively build parent→children). Public endpoint.
  - `findBySlug(slug)` — Single category with product count. `404` if not found or inactive (for public).
  - `findById(id)` — Admin lookup, includes inactive.
  - `create(dto)` — Auto-generate slug from name (use slug utility). Validate parentId exists if provided.
  - `update(id, dto)` — Re-generate slug if name changes. Prevent setting parentId to self or own child (cycle detection).
  - `delete(id)` — Prevent deletion if category has products. Offer force-delete with product reassignment or orphan.
    > **Note:** Slug generation must handle duplicates: if "electronics" exists, create "electronics-2". The tree builder should handle N levels deep but use a safeguard against infinite recursion (max 10 levels).

### Step 6.3: Categories controller

- [x] **Task:** Implement:
  - `GET /categories` — `@Public()` → active categories for storefront
  - `GET /categories/tree` — `@Public()` → nested tree
  - `GET /categories/admin` — `@Permissions('read:category')` → all including inactive
  - `GET /categories/:slug` — `@Public()` → by slug
  - `POST /categories` — `@Permissions('create:category')` → create
  - `PATCH /categories/:id` — `@Permissions('update:category')` → update
  - `DELETE /categories/:id` — `@Permissions('delete:category')` → delete
- [x] **Test:** Unit tests for CRUD, slug generation, tree building, cycle prevention.

---

## Phase 7 — Product Management

### Step 7.1: Products module

- [x] **Task:** Create `src/products/products.module.ts`, `products.controller.ts`, `products.service.ts`.
- [x] **Task:** Create DTOs: `create-product.dto.ts` (all fields with validation: name, description, price > 0, sku, stock >= 0, categoryId, etc.), `update-product.dto.ts`, `product-query.dto.ts` (extends PaginationQueryDto: categoryId?, minPrice?, maxPrice?, search?, isActive?, isFeatured?, sortBy: 'price'|'createdAt'|'name').

### Step 7.2: Products service

- [x] **Task:** Implement `ProductsService`:
  - `findAll(query: ProductQueryDto)` — Paginated, filterable (category, price range, featured, active), searchable (name, description via `contains` or full-text search), sortable. Public sees only active + non-deleted.
  - `findBySlug(slug)` — With category, images, avg rating (aggregate). `404` if inactive/deleted (public).
  - `findById(id)` — Admin, includes deleted.
  - `create(dto)` — Auto-generate slug, validate categoryId exists. Return with relations.
  - `update(id, dto)` — Update fields, re-slug if name changes.
  - `updateStock(id, quantity, operation: 'increment'|'decrement'|'set')` — For admin stock management.
  - `softDelete(id)` — Set `deletedAt`.
  - `restore(id)` — Clear `deletedAt`.
  - `addImages(productId, images: { url, alt, sortOrder }[])` — Batch create.
  - `removeImage(imageId)` — Delete image record (and file).
  - `reorderImages(productId, imageIds: string[])` — Update sortOrder.
    > **Note:** For stock decrement during checkout, DO NOT use this method. The checkout flow will use an atomic Prisma operation with a WHERE condition (`stock >= quantity`) to prevent overselling. This method is only for admin inventory management.

### Step 7.3: Products controller

- [x] **Task:** Implement:
  - `GET /products` — `@Public()` → paginated, filtered, searched
  - `GET /products/:slug` — `@Public()` → single product
  - `GET /products/admin/all` — `@Permissions('read:product')` → admin list with deleted
  - `GET /products/admin/:id` — `@Permissions('read:product')` → admin single
  - `POST /products` — `@Permissions('create:product')` → create
  - `PATCH /products/:id` — `@Permissions('update:product')` → update
  - `PATCH /products/:id/stock` — `@Permissions('update:product')` → stock management
  - `DELETE /products/:id` — `@Permissions('delete:product')` → soft delete
  - `PATCH /products/:id/restore` — `@Permissions('update:product')` → restore
  - `POST /products/:id/images` — `@Permissions('update:product')` → upload images
  - `DELETE /products/images/:imageId` — `@Permissions('update:product')` → remove image
- [x] **Test:** Unit tests for CRUD, search/filter logic, stock operations. Integration test for full product lifecycle including image management.

---

## Phase 8 — File Upload Service

### Step 8.1: Files module

- [x] **Task:** Create `src/files/files.module.ts`, `files.controller.ts`, `files.service.ts`.
- [x] **Task:** Configure `MulterModule` with:
  - Destination: `UPLOAD_DIR` from env (default: `./uploads`).
  - File size limit: 5MB.
  - File filter: allow only image types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`).
  - Filename: `${uuid}-${originalname}` (prevent collisions + path traversal).
- [x] **Task:** Implement `FilesService`:
  - `uploadFile(file: Express.Multer.File)` — Returns the relative URL path.
  - `uploadFiles(files: Express.Multer.File[])` — Batch upload, returns array of paths.
  - `deleteFile(filePath)` — Remove file from disk. Validate path is within UPLOAD_DIR (prevent directory traversal attack).
- [x] **Task:** In `main.ts`, serve the uploads directory as static files using `app.useStaticAssets()` or `ServeStaticModule`. Mount at `/uploads/`.
  > **Note:** SECURITY: Validate file paths strictly. Never allow `..` in paths. Use `path.resolve` and check the resolved path starts with the uploads directory. Validate MIME types by reading magic bytes, not just extension.
- [x] **Test:** Unit test for file service. Integration test for upload endpoint.

---

## Phase 9 — Cart Management

### Step 9.1: Cart module

- [x] **Task:** Create `src/cart/cart.module.ts`, `cart.controller.ts`, `cart.service.ts`.
- [x] **Task:** Create DTOs: `add-to-cart.dto.ts` (productId, quantity: min 1), `update-cart-item.dto.ts` (quantity: min 1).

### Step 9.2: Cart service

- [x] **Task:** Implement `CartService`:
  - `getCart(userId)` — Get or create cart. Return items with product details (name, price, images, stock). Calculate item subtotals and cart total on the fly (not stored — always computed from current prices).
  - `addItem(userId, dto)` — Validate product exists, is active, has sufficient stock. If product already in cart, increment quantity. Check stock availability.
  - `updateItemQuantity(userId, itemId, quantity)` — Validate stock. If quantity is 0, remove item.
  - `removeItem(userId, itemId)` — Delete CartItem.
  - `clearCart(userId)` — Delete all CartItem records for user's cart.
  - `validateCart(userId)` — Check all items still available, in stock, and active. Return `{ valid: boolean, issues: string[] }`. Called before checkout.
    > **Note:** Cart totals are NEVER stored in the DB — always computed from current product prices. This ensures price changes are reflected immediately. Stock validation at add-time is a courtesy check; the real enforcement happens at checkout.

### Step 9.3: Cart controller

- [x] **Task:** Implement (all authenticated, no special permissions — user manages own cart):
  - `GET /cart` → get cart with items
  - `POST /cart/items` → add item
  - `PATCH /cart/items/:id` → update quantity
  - `DELETE /cart/items/:id` → remove item
  - `DELETE /cart` → clear cart
  - `GET /cart/validate` → validate cart before checkout
- [x] **Test:** Unit tests for all cart operations, stock validation, price computation.

---

## Phase 10 — Address Management

### Step 10.1: Addresses module

- [x] **Task:** Create `src/addresses/addresses.module.ts`, `addresses.controller.ts`, `addresses.service.ts`.
- [x] **Task:** Create DTOs: `create-address.dto.ts` (all fields validated), `update-address.dto.ts`.

### Step 10.2: Addresses service & controller

- [x] **Task:** Implement `AddressesService`:
  - `findAllByUser(userId)` → all addresses for user.
  - `findById(userId, addressId)` → single, verify ownership.
  - `create(userId, dto)` → if `isDefault: true`, unset other defaults of same type first (in transaction).
  - `update(userId, addressId, dto)` → verify ownership, handle default switching.
  - `delete(userId, addressId)` → verify ownership, prevent deleting if used in pending orders (by snapshot, this is fine — snapshots are copies).
  - `setDefault(userId, addressId, type)` → unset previous default, set new.
- [x] **Task:** Implement controller (all authenticated, user manages own):
  - `GET /addresses` → list
  - `GET /addresses/:id` → single
  - `POST /addresses` → create
  - `PATCH /addresses/:id` → update
  - `DELETE /addresses/:id` → delete
  - `PATCH /addresses/:id/default` → set as default
- [x] **Test:** Unit tests for address CRUD, default handling, ownership verification.

---

## Phase 11 — Coupon Management

### Step 11.1: Coupons module

- [x] **Task:** Create `src/coupons/coupons.module.ts`, `coupons.controller.ts`, `coupons.service.ts`.
- [x] **Task:** Create DTOs: `create-coupon.dto.ts`, `update-coupon.dto.ts`, `validate-coupon.dto.ts` (code, orderSubtotal).

### Step 11.2: Coupons service & controller

- [x] **Task:** Implement `CouponsService`:
  - `findAll(paginationDto)` — Admin: paginated list.
  - `findById(id)` — Admin.
  - `create(dto)` — Admin: create coupon. Code auto-uppercased.
  - `update(id, dto)` — Admin.
  - `delete(id)` — Admin: only if `currentUses === 0`.
  - `validateCoupon(code, orderSubtotal)` — Public validation:
    1. Check coupon exists and is active.
    2. Check not expired (`expiresAt > now` or null).
    3. Check started (`startsAt <= now` or null).
    4. Check usage limit (`currentUses < maxUses` or maxUses is null).
    5. Check minimum order amount (`orderSubtotal >= minOrderAmount` or null).
    6. Calculate discount: if PERCENTAGE, `subtotal * value / 100` capped at `maxDiscountAmount`; if FIXED, `value`.
    7. Return `{ valid, discountAmount, message }`.
  - `applyCoupon(couponId)` — Increment `currentUses`. Used during checkout.
    > **Note:** Coupon validation is read-only. `applyCoupon` is called within the checkout transaction to ensure atomicity.

- [x] **Task:** Implement controller:
  - `GET /coupons` — `@Permissions('read:coupon')` → admin list
  - `GET /coupons/:id` — `@Permissions('read:coupon')` → admin single
  - `POST /coupons` — `@Permissions('create:coupon')` → create
  - `PATCH /coupons/:id` — `@Permissions('update:coupon')` → update
  - `DELETE /coupons/:id` — `@Permissions('delete:coupon')` → delete
  - `POST /coupons/validate` — Authenticated → validate coupon code
- [x] **Test:** Unit tests for coupon validation logic (expired, max uses, min order, percentage cap, etc.).

---

## Phase 12 — Order & Checkout (with Idempotency)

### Step 12.1: Idempotency middleware

- [x] **Task:** Create `src/common/middleware/idempotency.middleware.ts`:
  1. Applied only to `POST /orders/checkout`.
  2. Read `Idempotency-Key` header from the request. If missing, throw `400 Bad Request`.
  3. Use `RedisService.setNX(idempotency:${key}, 'processing', 300)` — 5 min TTL.
  4. If `setNX` returns false (key already exists):
     a. Read stored value — if `processing`, return `409 Conflict` ("Request is being processed").
     b. If stored value is a JSON response, return that cached response (same status code + body).
  5. If `setNX` returns true, proceed to controller. After response, store the response JSON in Redis with the key.
     > **Note:** This middleware is the FIRST line of defense against double-click checkout. The Prisma `idempotencyKey` unique constraint on Order is the SECOND line. Together they make double-ordering impossible. The Redis key expires after 5 minutes so the same key can't be reused after that window.

### Step 12.2: Orders module

- [x] **Task:** Create `src/orders/orders.module.ts`, `orders.controller.ts`, `orders.service.ts`.
- [x] **Task:** Create DTOs: `create-order.dto.ts` (shippingAddressId, billingAddressId?, couponCode?, notes?, idempotencyKey), `update-order-status.dto.ts` (status — with valid transition validation), `order-query.dto.ts` (extends PaginationQueryDto: status?, dateFrom?, dateTo?).

### Step 12.3: Orders service — The Checkout Flow

- [x] **Task:** Implement `OrdersService.checkout(userId, dto)` — **THE MOST CRITICAL METHOD**:

  This MUST run in a Prisma interactive transaction (`prisma.$transaction(async (tx) => { ... })`) with a timeout of 30 seconds:
  1. **Validate cart:** Fetch cart with items + product details. If empty, throw `400`.
  2. **Validate stock (atomic):** For EACH cart item, run:
     ```
     tx.product.update({
       where: { id: productId, stock: { gte: quantity } },
       data: { stock: { decrement: quantity } }
     })
     ```
     If ANY update affects 0 rows (Prisma throws P2025), throw `400 "Insufficient stock for {productName}"`. The transaction will rollback all previous decrements.
  3. **Validate & apply coupon** (if provided): Call `CouponsService.validateCoupon()` inside the transaction. If valid, increment `currentUses`.
  4. **Snapshot addresses:** Fetch shipping (and billing) address. Serialize to JSON for `shippingAddressSnapshot` and `billingAddressSnapshot`.
  5. **Calculate totals:**
     - `subtotalAmount` = sum of (item.price \* item.quantity)
     - `discountAmount` = coupon discount (if any)
     - `shippingAmount` = calculated shipping cost (or flat rate)
     - `taxAmount` = 0 (can be extended later)
     - `totalAmount` = subtotal - discount + shipping + tax
  6. **Generate order number:** Format: `ORD-{YYYYMMDD}-{random4digits}`. Ensure uniqueness.
  7. **Create order** with OrderItems (snapshot product name, sku, unit price at time of order).
  8. **Clear cart** — delete all CartItems.
  9. **Create Stripe PaymentIntent** via `PaymentsService.createPaymentIntent(order)`. Get `clientSecret`.
  10. **Create Payment record** with status PENDING and stripePaymentIntentId.
  11. **Return** `{ order, clientSecret }` for frontend to complete Stripe payment.

  > **CRITICAL NOTES:**
  >
  > - The stock decrement with WHERE clause is an **optimistic lock** — it's the ONLY safe way to prevent overselling.
  > - If Prisma throws P2002 on `idempotencyKey`, the global filter returns 409 — second layer of double-click protection.
  > - The transaction isolates everything: if payment intent creation fails, stock is restored.
  > - Address snapshots ensure the order record is immutable even if the user later changes their address.
  > - Product name/price snapshots in OrderItem ensure the order history is accurate even if products change.

### Step 12.4: Order management methods

- [x] **Task:** Implement remaining `OrdersService` methods:
  - `findAllByUser(userId, query)` — Paginated orders for the authenticated user.
  - `findAll(query)` — Admin: paginated, filterable by status/date.
  - `findById(id, userId?)` — If userId provided, verify ownership for customers.
  - `updateStatus(id, status)` — Admin. Validate status transitions (e.g., can't go from DELIVERED back to PENDING). Update timestamps (`shippedAt`, `deliveredAt`, `cancelledAt`) accordingly.
  - `cancelOrder(id, userId)` — User can cancel if status is PENDING or CONFIRMED. Restore stock (increment), refund payment if already charged, update coupon usage (decrement `currentUses`). Must run in a transaction.
  - `getOrderStats()` — Admin dashboard: total orders, revenue, orders by status, recent orders.

### Step 12.5: Orders controller

- [x] **Task:** Implement:
  - `POST /orders/checkout` — Authenticated → checkout (apply idempotency middleware)
  - `GET /orders` — Authenticated → user's orders
  - `GET /orders/admin` — `@Permissions('read:order')` → all orders
  - `GET /orders/admin/stats` — `@Permissions('read:analytics')` → order statistics
  - `GET /orders/:id` — Authenticated → single order (ownership check for customers)
  - `PATCH /orders/:id/status` — `@Permissions('update:order')` → update status
  - `POST /orders/:id/cancel` — Authenticated → cancel order (user can cancel own pending/confirmed)
- [x] **Test:** Unit tests — this is the HIGHEST priority test suite:
  - Test successful checkout: cart → order → stock decremented → cart cleared.
  - Test insufficient stock: ensure stock is NOT decremented, order NOT created.
  - Test concurrent checkout (same cart, different idempotency keys): only first succeeds.
  - Test idempotency: same key returns same response.
  - Test coupon applied and usage incremented.
  - Test cancellation: stock restored, payment refunded.
  - Test status transition validation.
  - Test address snapshot immutability.
- [x] **Test:** Integration test — full checkout flow end-to-end.


---

## Phase 13 — Payment Integration (Stripe)

### Step 13.1: Payments module

- [ ] **Task:** Create `src/payments/payments.module.ts`, `payments.controller.ts`, `payments.service.ts`.
- [ ] **Task:** Initialize Stripe SDK with `STRIPE_SECRET_KEY` from env.

### Step 13.2: Payments service

- [ ] **Task:** Implement `PaymentsService`:
  - `createPaymentIntent(order)` — Create Stripe PaymentIntent with `amount` (in cents), `currency`, `metadata: { orderId, orderNumber, userId }`. Return `{ paymentIntentId, clientSecret }`.
  - `handleWebhook(payload, signature)` — Verify webhook signature with `STRIPE_WEBHOOK_SECRET`. Handle events:
    - `payment_intent.succeeded` → Update Payment status to SUCCEEDED, Order status to CONFIRMED. Queue confirmation email.
    - `payment_intent.payment_failed` → Update Payment status to FAILED, Order status to PENDING (let user retry).
    - `charge.refunded` → Update Payment status to REFUNDED, Order status to REFUNDED.
  - `refundPayment(paymentIntentId)` — Create Stripe refund. Update local Payment record.
    > **Note:** Webhook handler must use the RAW body (not parsed JSON) for signature verification. In `main.ts`, apply `rawBody: true` in `NestFactory.create()` options. The webhook endpoint must be `@Public()` and skip the `ValidationPipe`.

### Step 13.3: Payments controller

- [ ] **Task:** Implement:
  - `POST /payments/webhook` — `@Public()`, raw body → handle Stripe webhook
    > **Note:** This is the only payment endpoint. PaymentIntent creation happens inside the checkout flow. Do NOT create an endpoint that lets clients create arbitrary payment intents.
- [ ] **Test:** Unit tests for webhook event handling (mock Stripe SDK). Test each event type updates correct statuses.

---

## Phase 14 — Reviews & Ratings

### Step 14.1: Reviews module

- [ ] **Task:** Create `src/reviews/reviews.module.ts`, `reviews.controller.ts`, `reviews.service.ts`.
- [ ] **Task:** Create DTOs: `create-review.dto.ts` (rating: 1-5, title?, comment?), `update-review.dto.ts`, `review-query.dto.ts`.

### Step 14.2: Reviews service & controller

- [ ] **Task:** Implement `ReviewsService`:
  - `create(userId, productId, dto)` — Validate user has purchased and received this product (has a DELIVERED order containing it). One review per user per product (unique constraint handles race condition via global filter → 409).
  - `findByProduct(productId, query)` — Paginated, only approved reviews for public. Include user firstName.
  - `findByUser(userId, query)` — User's own reviews.
  - `update(userId, reviewId, dto)` — User updates own review. Reset `isApproved` to false (re-moderation).
  - `delete(userId, reviewId)` — User deletes own, or admin deletes any.
  - `approve(reviewId)` — Admin: set `isApproved = true`.
  - `reject(reviewId)` — Admin: delete review (or set a rejected flag).
  - `getProductRatingStats(productId)` — Average rating, count, distribution (1★: N, 2★: N, etc.) using Prisma aggregation.

- [ ] **Task:** Implement controller:
  - `GET /products/:productId/reviews` — `@Public()` → product reviews (approved only)
  - `POST /products/:productId/reviews` — Authenticated → create review
  - `PATCH /reviews/:id` — Authenticated → update own review
  - `DELETE /reviews/:id` — Authenticated → delete own or admin
  - `PATCH /reviews/:id/approve` — `@Permissions('update:review')` → approve
  - `GET /reviews/pending` — `@Permissions('read:review')` → admin: pending reviews
- [ ] **Test:** Unit tests for purchase validation, rating stats, moderation flow.

---

## Phase 15 — Wishlist

### Step 15.1: Wishlist module

- [ ] **Task:** Create `src/wishlist/wishlist.module.ts`, `wishlist.controller.ts`, `wishlist.service.ts`.

### Step 15.2: Wishlist service & controller

- [ ] **Task:** Implement `WishlistService`:
  - `getWishlist(userId)` — List items with product details (name, price, image, stock status).
  - `addItem(userId, productId)` — Add to wishlist. Unique constraint handles duplicates (global filter → 409).
  - `removeItem(userId, productId)` — Remove.
  - `isInWishlist(userId, productId)` — Boolean check.
  - `moveToCart(userId, productId)` — Remove from wishlist + add to cart. Transaction.

- [ ] **Task:** Implement controller (all authenticated):
  - `GET /wishlist` → list
  - `POST /wishlist/:productId` → add
  - `DELETE /wishlist/:productId` → remove
  - `POST /wishlist/:productId/move-to-cart` → move to cart
- [ ] **Test:** Unit tests for add/remove, duplicate handling, move-to-cart.

---

## Phase 16 — Email Notifications

### Step 16.1: Mail module with Bull queue

- [ ] **Task:** Create `src/mail/mail.module.ts`, `mail.service.ts`, `mail.processor.ts`.
- [ ] **Task:** Configure `@nestjs/bull` with Redis connection. Create queue: `email`.
- [ ] **Task:** Implement `MailService`:
  - `sendOrderConfirmation(order, userEmail)` — Adds job to queue.
  - `sendOrderShipped(order, userEmail, trackingInfo?)` — Adds job to queue.
  - `sendOrderDelivered(order, userEmail)` — Adds job to queue.
  - `sendPasswordReset(email, resetUrl)` — Adds job to queue.
  - `sendWelcome(email, firstName)` — Adds job to queue.
    > **Note:** NEVER send emails synchronously inside request handlers. Always queue them. If email sending fails, it retries (Bull retries 3 times by default). This prevents email provider downtime from breaking the user experience.
- [ ] **Task:** Implement `MailProcessor` (`@Processor('email')`) — Processes jobs from the queue. Uses Nodemailer to send. Separate handlers for each email type via `@Process('order-confirmation')`, etc.
- [ ] **Task:** Create email templates as simple HTML strings (template literals) — no external templating engine needed. Include: order details, items list, totals, address.
- [ ] **Test:** Unit test that the correct job is added to the queue for each method. Mock Bull queue.

---

## Phase 17 — Redis Caching

### Step 17.1: Cache interceptor

- [ ] **Task:** Create `src/common/interceptors/cache.interceptor.ts` — Custom cache interceptor that:
  1. Generates cache key from URL + query params.
  2. Checks Redis for cached response. If found, return immediately.
  3. If not found, proceed to handler, cache the response with a configurable TTL.
  4. Cache is only applied to GET requests on `@Public()` endpoints.
- [ ] **Task:** Create `src/common/decorators/cache-ttl.decorator.ts` — `@CacheTTL(seconds)` decorator.
- [ ] **Task:** Apply caching to:
  - `GET /products` — TTL: 60s
  - `GET /products/:slug` — TTL: 60s
  - `GET /categories` — TTL: 300s (categories change rarely)
  - `GET /categories/tree` — TTL: 300s
    > **Note:** Cache invalidation: When a product/category is created, updated, or deleted, bust the relevant cache keys via `RedisService.del()`. Implement this in the service methods. Use key patterns like `cache:products:*` and Redis `SCAN` + `DEL` for pattern-based invalidation.
- [ ] **Test:** Unit test cache hit/miss logic.

---

## Phase 18 — Rate Limiting

### Step 18.1: Throttler configuration

- [ ] **Task:** Configure `@nestjs/throttler` in `AppModule`:
  - Default: 60 requests per 60 seconds per IP.
  - Short burst: 10 requests per 10 seconds.
  - Use Redis storage adapter for distributed rate limiting (if multiple instances).
- [ ] **Task:** Create `src/common/guards/throttler-behind-proxy.guard.ts` — Override `getTracker()` to use `X-Forwarded-For` header if behind a reverse proxy.
- [ ] **Task:** Apply stricter limits to sensitive endpoints:
  - `POST /auth/login` — `@Throttle({ default: { limit: 5, ttl: 60000 } })` (5 per minute)
  - `POST /auth/forgot-password` — `@Throttle({ default: { limit: 3, ttl: 60000 } })` (3 per minute)
  - `POST /orders/checkout` — `@Throttle({ default: { limit: 3, ttl: 60000 } })` (3 per minute)
- [ ] **Test:** Integration test verifying rate limits return 429 after threshold.

---

## Phase 19 — Health Checks

### Step 19.1: Health module

- [ ] **Task:** Create `src/health/health.module.ts`, `health.controller.ts`.
- [ ] **Task:** Implement health checks using `@nestjs/terminus`:
  - Database health: `PrismaHealthIndicator` — runs `prisma.$queryRaw('SELECT 1')`.
  - Redis health: Check `RedisService` ping.
  - Disk health: Check upload directory has space.
  - Memory health: Check heap usage threshold.
- [ ] **Task:** Implement controller:
  - `GET /health` — `@Public()` → aggregated health status
    > **Note:** Health endpoint should be outside the `/api/v1` prefix. Use `@Controller()` with explicit path.

---

## Phase 20 — Shipping Calculation

### Step 20.1: Shipping service

- [ ] **Task:** Create `src/orders/shipping.service.ts` (inside orders module, not a separate module).
- [ ] **Task:** Implement simple shipping calculation:
  - Free shipping above a configurable threshold (e.g., $100).
  - Flat rate shipping below the threshold (configurable, e.g., $10).
  - Weight-based add-on: if total weight exceeds a threshold, add surcharge.
  - Store thresholds in env vars or a settings table (for now, env vars).
    > **Note:** This is a simplified shipping module. Real-world would integrate with shipping carriers (UPS, FedEx). The structure allows future extension — the `calculateShipping(address, cartItems)` method signature is the contract. Checkout calls this method.
- [ ] **Test:** Unit tests for shipping calculation edge cases (free shipping boundary, weight surcharge).

---

## Phase 21 — Admin Dashboard Endpoints

### Step 21.1: Analytics

- [ ] **Task:** Add admin analytics endpoints in `OrdersController` (or a separate `AnalyticsController`):
  - `GET /admin/analytics/overview` — `@Permissions('read:analytics')`:
    - Total revenue (sum of completed orders)
    - Total orders (by status)
    - Total customers
    - Total products
    - Average order value
    - Recent orders (last 10)
  - `GET /admin/analytics/revenue` — `@Permissions('read:analytics')`:
    - Revenue by day/week/month (query param for period)
    - Grouped using Prisma `groupBy`
  - `GET /admin/analytics/top-products` — `@Permissions('read:analytics')`:
    - Top 10 selling products by quantity
  - `GET /admin/analytics/low-stock` — `@Permissions('read:analytics')`:
    - Products where `stock <= lowStockThreshold`
- [ ] **Test:** Unit tests for aggregation queries.

---

## Phase 22 — Final Integration, Security & E2E Tests

### Step 22.1: Security hardening

- [ ] **Task:** Audit all endpoints:
  - Verify every non-public endpoint requires authentication.
  - Verify every admin endpoint has correct `@Permissions()`.
  - Verify all user inputs are validated with DTOs.
  - Verify no sensitive data (passwords, tokens, cost prices) leaks in responses.
  - Verify Stripe webhook signature validation.
  - Verify file upload path traversal protection.
- [ ] **Task:** Add Swagger decorators to ALL controllers:
  - `@ApiTags()`, `@ApiOperation()`, `@ApiResponse()`, `@ApiBearerAuth()` on protected endpoints.
  - Document request/response DTOs with `@ApiProperty()`.

### Step 22.2: Docker setup

- [ ] **Task:** Create `Dockerfile` (multi-stage build: build → production).
- [ ] **Task:** Create `docker-compose.yml` with services: `app`, `postgres`, `redis`.
- [ ] **Task:** Create `.dockerignore`.

### Step 22.3: End-to-end tests

- [ ] **Task:** Write comprehensive E2E test suite in `test/`:
  1. **Auth flow:** Register → login → access protected → refresh → logout.
  2. **Product browsing:** List products → filter → search → view single.
  3. **Shopping flow:** Add to cart → update quantity → remove item → clear cart.
  4. **Full checkout flow:** Add items → validate cart → checkout with idempotency key → verify stock decremented → verify order created.
  5. **Double checkout protection:** Send same idempotency key twice → second returns cached/conflict.
  6. **Admin flow:** Create category → create product → update stock → view orders → update order status.
  7. **Permission enforcement:** Customer tries admin endpoint → 403 Forbidden.
  8. **Review flow:** Purchase product → order delivered → write review → admin approve.
  9. **Coupon flow:** Create coupon → validate → checkout with coupon → verify discount.
  10. **Cancellation:** Create order → cancel → verify stock restored.
      > **Note:** Use a separate test database. Reset DB before each test suite using Prisma migrate reset. Use supertest for HTTP assertions. Structure tests with `describe`/`it` blocks mirroring the user journey.

### Step 22.4: Final AppModule wiring

- [ ] **Task:** Verify `AppModule` imports ALL modules in correct order:
  1. ConfigModule (global)
  2. PrismaModule (global)
  3. RedisModule (global)
  4. ThrottlerModule
  5. BullModule
  6. AuthModule (registers global guards)
  7. UsersModule
  8. RolesModule
  9. CategoriesModule
  10. ProductsModule
  11. FilesModule
  12. CartModule
  13. AddressesModule
  14. CouponsModule
  15. OrdersModule (depends on Cart, Address, Coupon, Payment, Mail)
  16. PaymentsModule
  17. ReviewsModule
  18. WishlistModule
  19. MailModule
  20. HealthModule

---

## Summary of Key Architectural Decisions

| Decision                                                      | Rationale                                                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Global Prisma Exception Filter                                | Catches P2002/P2025/P2003 race conditions. Returns proper HTTP codes. Never leaks internals.                                             |
| Idempotency Middleware (Redis `setNX`) + DB unique constraint | Two-layer protection against double-click checkout. Redis is fast first check, DB constraint is guaranteed fallback.                     |
| Optimistic stock locking (`UPDATE WHERE stock >= qty`)        | Prevents overselling in concurrent requests without pessimistic locks. If stock insufficient, Prisma throws → transaction auto-rollback. |
| JWT with permissions in payload                               | Avoids DB lookup on every request. 15min access token means permissions are stale max 15min. Acceptable tradeoff.                        |
| Refresh token rotation                                        | Stolen refresh token becomes invalid on next legitimate use. Detection of theft.                                                         |
| Address/price snapshots in orders                             | Order history is immutable. Changing product price or user address never affects past orders.                                            |
| Bull queue for emails                                         | Email sending failures don't break request flow. Automatic retries. Decoupled architecture.                                              |
| Redis caching with targeted invalidation                      | High-traffic GET endpoints served from cache. Invalidation on writes ensures freshness.                                                  |
| Soft deletes for users/products                               | Preserve data integrity for related orders/reviews. Allow recovery.                                                                      |
| Decimal type for all money fields                             | IEEE 754 float arithmetic causes rounding errors in financial calculations. Prisma Decimal uses arbitrary precision.                     |
