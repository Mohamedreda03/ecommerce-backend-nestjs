# Postman Coverage Plan (All API Routes)

## Goal

Generate a complete Postman collection that covers **all REST routes** in this NestJS project with:

- Accurate HTTP method + URL path (including global prefix `/api/v1`)
- Route description for every request (prefer `@ApiOperation` summary)
- Auth setup (`Bearer` for protected routes, `No Auth` for public routes)
- Test-ready sample request data for body/query/params
- Basic response assertions to quickly validate endpoint health

## Scope

Controllers included from `src/**/*controller.ts`:

- app
- auth
- users
- products
- categories
- orders
- cart
- wishlist
- addresses
- coupons
- files
- payments
- reviews
- roles
- health

## Implementation Strategy

1. Parse all controller files under `src/`.
2. Extract for each endpoint:

- `@Controller(...)` prefix
- HTTP decorator (`@Get`, `@Post`, `@Patch`, `@Delete`)
- Route fragment from decorator argument
- `@ApiOperation` summary
- Auth decorators (`@Public`, `@ApiBearerAuth`, `@Permissions`, guards)
- DTO usage from method signature (`@Body()`, `@Query()`)

3. Build full URL as `{{baseUrl}}/api/v1/<controller-prefix>/<method-path>`.
4. Attach sample request payloads by DTO name from a curated map of valid values.
5. Generate one Postman collection JSON with folder-per-module structure.
6. Add collection-level test script and route-level expected status checks.

## Data Design For Testing

Collection variables include:

- Base/env: `baseUrl`, `accessToken`, `refreshToken`
- Common IDs: `userId`, `roleId`, `permissionId`, `productId`, `categoryId`, `orderId`, `couponId`, `addressId`, `reviewId`, `imageId`, `cartItemId`
- Public keys/slugs: `productSlug`, `categorySlug`, `couponCode`
- Files/webhook: `uploadedFilePath`, `stripeSignature`

## Validation Rules

- Every extracted endpoint must exist exactly once in the output collection.
- Public endpoints must explicitly set `No Auth`.
- Protected endpoints use Bearer token (`{{accessToken}}`).
- DTO-backed endpoints include realistic sample body/query data.
- `204` endpoints use status assertion that allows `204`.

## Output Files

- `postman/generate-postman-collection.js` (generator)
- `postman/ecommerce-api.postman_collection.json` (generated collection)

## How To Regenerate

Run:

```bash
node postman/generate-postman-collection.js
```

This ensures the Postman file stays in sync whenever routes/DTOs change.
