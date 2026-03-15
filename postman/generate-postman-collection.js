const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const OUTPUT_FILE = path.join(
  ROOT,
  'postman',
  'ecommerce-api.postman_collection.json',
);

const DTO_EXAMPLES = {
  RegisterDto: {
    email: 'customer@example.com',
    password: 'StrongPass@123',
    firstName: 'John',
    lastName: 'Doe',
  },
  RefreshTokenDto: {
    refreshToken: '{{refreshToken}}',
  },
  ForgotPasswordDto: {
    email: 'customer@example.com',
  },
  ResetPasswordDto: {
    token: 'reset-token-from-email',
    newPassword: 'NewStrongPass@123',
  },
  ChangePasswordDto: {
    currentPassword: 'StrongPass@123',
    newPassword: 'StrongPass@456',
  },
  CreateUserDto: {
    email: 'staff@example.com',
    password: 'StrongPass@123',
    firstName: 'Staff',
    lastName: 'User',
    phone: '+201001112233',
    roleId: '{{roleId}}',
    isActive: true,
  },
  UpdateUserDto: {
    firstName: 'Updated',
    lastName: 'User',
    phone: '+201009998877',
    isActive: true,
  },
  UpdateProfileDto: {
    firstName: 'Profile',
    lastName: 'Owner',
    phone: '+201234567890',
    avatar: 'https://cdn.example.com/avatars/u1.png',
  },
  CreateProductDto: {
    name: 'iPhone 15 Pro',
    description: 'Latest Apple smartphone',
    shortDescription: 'Premium smartphone',
    price: 999.99,
    compareAtPrice: 1199.99,
    costPrice: 750.0,
    sku: 'IPHONE-15-PRO-256',
    stock: 50,
    lowStockThreshold: 5,
    weight: 0.174,
    isActive: true,
    isFeatured: false,
    categoryId: '{{categoryId}}',
  },
  UpdateProductDto: {
    name: 'iPhone 15 Pro Max',
    price: 1099.99,
    stock: 35,
    isFeatured: true,
  },
  ProductQueryDto: {
    page: 1,
    limit: 20,
    categoryId: '{{categoryId}}',
    minPrice: 10,
    maxPrice: 5000,
    search: 'iphone',
    isActive: true,
    isFeatured: false,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  UpdateStockDto: {
    quantity: 5,
    operation: 'increment',
  },
  AddProductImagesDto: {
    images: [
      {
        url: 'https://cdn.example.com/products/p1-front.jpg',
        alt: 'Front view',
        sortOrder: 0,
      },
      {
        url: 'https://cdn.example.com/products/p1-back.jpg',
        alt: 'Back view',
        sortOrder: 1,
      },
    ],
  },
  ReorderImagesDto: {
    imageIds: ['{{imageId}}', '{{secondImageId}}'],
  },
  CreateCategoryDto: {
    name: 'Electronics',
    description: 'Electronic devices and accessories',
    parentId: '{{parentCategoryId}}',
    image: 'https://cdn.example.com/categories/electronics.jpg',
    sortOrder: 0,
    isActive: true,
  },
  UpdateCategoryDto: {
    name: 'Updated Electronics',
    description: 'Updated category description',
    isActive: true,
  },
  CreateOrderDto: {
    shippingAddressId: '{{addressId}}',
    billingAddressId: '{{billingAddressId}}',
    couponCode: '{{couponCode}}',
    notes: 'Please call before delivery',
    idempotencyKey: 'order-{{orderIdempotencySuffix}}',
  },
  UpdateOrderStatusDto: {
    status: 'SHIPPED',
  },
  OrderQueryDto: {
    page: 1,
    limit: 20,
    status: 'PENDING',
    dateFrom: '2026-01-01T00:00:00.000Z',
    dateTo: '2026-12-31T23:59:59.000Z',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  AddToCartDto: {
    productId: '{{productId}}',
    quantity: 1,
  },
  UpdateCartItemDto: {
    quantity: 2,
  },
  CreateCouponDto: {
    code: 'SUMMER20',
    description: '20% off summer campaign',
    discountType: 'PERCENTAGE',
    discountValue: '20.00',
    minOrderAmount: '50.00',
    maxDiscountAmount: '100.00',
    maxUses: 100,
    isActive: true,
    startsAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-08-31T23:59:59.000Z',
  },
  UpdateCouponDto: {
    description: 'Updated coupon description',
    maxUses: 200,
    isActive: true,
  },
  ValidateCouponDto: {
    code: '{{couponCode}}',
    orderSubtotal: '150.00',
  },
  DeleteFileDto: {
    filePath: '{{uploadedFilePath}}',
  },
  CreateReviewDto: {
    rating: 5,
    title: 'Excellent Product',
    comment: 'Works exactly as expected.',
  },
  UpdateReviewDto: {
    rating: 4,
    title: 'Updated Review',
    comment: 'Still good after 2 weeks of use.',
  },
  ReviewQueryDto: {
    page: 1,
    limit: 20,
    rating: 5,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  CreateRoleDto: {
    name: 'EDITOR',
    description: 'Can edit products and categories',
    permissionIds: ['{{permissionId}}'],
  },
  UpdateRoleDto: {
    name: 'SENIOR_EDITOR',
    description: 'Can edit plus approve content',
    permissionIds: ['{{permissionId}}', '{{secondPermissionId}}'],
  },
  AssignRoleDto: {
    userId: '{{userId}}',
    roleId: '{{roleId}}',
  },
  CreateAddressDto: {
    type: 'SHIPPING',
    firstName: 'John',
    lastName: 'Doe',
    street: '123 Main Street',
    city: 'Cairo',
    state: 'Cairo Governorate',
    country: 'Egypt',
    zipCode: '11511',
    phone: '+201001112233',
    isDefault: true,
  },
  UpdateAddressDto: {
    city: 'Giza',
    state: 'Giza Governorate',
    zipCode: '12611',
    isDefault: false,
  },
  SetDefaultAddressDto: {
    type: 'SHIPPING',
  },
  PaginationQueryDto: {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
};

const SPECIAL_BODIES = {
  'POST /auth/login': {
    email: 'customer@example.com',
    password: 'StrongPass@123',
  },
  'POST /payments/webhook':
    '{"id":"evt_test_webhook","type":"payment_intent.succeeded"}',
};

const VAR_BY_PARAM = {
  id: 'id',
  userId: 'userId',
  roleId: 'roleId',
  permissionId: 'permissionId',
  productId: 'productId',
  categoryId: 'categoryId',
  parentId: 'parentCategoryId',
  orderId: 'orderId',
  couponId: 'couponId',
  addressId: 'addressId',
  reviewId: 'reviewId',
  imageId: 'imageId',
  itemId: 'cartItemId',
  productSlug: 'productSlug',
  categorySlug: 'categorySlug',
  slug: 'slug',
};

function listControllerFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...listControllerFiles(full));
      continue;
    }
    if (e.isFile() && e.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }
  return '';
}

function normalizePath(controllerPrefix, methodPath) {
  const parts = [controllerPrefix, methodPath]
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ''));

  return '/' + parts.join('/');
}

function parseController(content, filePath) {
  const classBlockMatch = content.match(/([\s\S]*?)export\s+class\s+\w+/);
  const classBlock = classBlockMatch ? classBlockMatch[1] : '';

  const controllerMatch = classBlock.match(/@Controller\(([^)]*)\)/);
  const controllerPrefix = controllerMatch
    ? stripQuotes(controllerMatch[1])
    : '';

  const classHasBearer = /@ApiBearerAuth\(/.test(classBlock);
  const classHasPublic = /@Public\(/.test(classBlock);
  const classHasJwtGuard = /UseGuards\([^)]*JwtAuthGuard/.test(classBlock);

  const moduleName =
    path.relative(SRC_DIR, filePath).split(path.sep)[0] || 'root';

  const endpointRegex =
    /((?:\s*@[^\n]+\n)+)\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?::\s*[^\{]+)?\{/g;
  const endpoints = [];
  let match;

  while ((match = endpointRegex.exec(content)) !== null) {
    const decorators = match[1];
    const methodName = match[2];
    const signature = match[3];

    const httpMatch = decorators.match(/@(Get|Post|Patch|Delete)\(([^)]*)\)/);
    if (!httpMatch) continue;

    const method = httpMatch[1].toUpperCase();
    const methodPath = stripQuotes(httpMatch[2] || '');
    const endpointPath = normalizePath(controllerPrefix, methodPath);

    const summaryMatch = decorators.match(
      /@ApiOperation\(\{\s*summary:\s*(['"`])([\s\S]*?)\1\s*\}\)/,
    );
    const summary = summaryMatch ? summaryMatch[2].replace(/\\'/g, "'") : '';

    const methodHasPublic = /@Public\(/.test(decorators);
    const methodHasBearer = /@ApiBearerAuth\(/.test(decorators);
    const hasPermissions = /@Permissions\(/.test(decorators);

    const bodyDtoMatch = signature.match(
      /@Body\(\)\s+\w+\s*:\s*([A-Za-z0-9_]+)/,
    );
    const queryDtoMatch = signature.match(
      /@Query\(\)\s+\w+\s*:\s*([A-Za-z0-9_]+)/,
    );

    const bodyDto = bodyDtoMatch ? bodyDtoMatch[1] : null;
    const queryDto = queryDtoMatch ? queryDtoMatch[1] : null;

    const isPublic = classHasPublic || methodHasPublic;
    const needsAuth =
      !isPublic &&
      (classHasBearer ||
        classHasJwtGuard ||
        methodHasBearer ||
        hasPermissions ||
        /@CurrentUser\(/.test(signature));

    const hasNoContent = /HttpStatus\.NO_CONTENT/.test(decorators);
    const hasOkCode = /HttpStatus\.OK/.test(decorators);

    let expectedStatus = 200;
    if (hasNoContent) expectedStatus = 204;
    else if (hasOkCode) expectedStatus = 200;
    else if (method === 'POST') expectedStatus = 201;

    endpoints.push({
      moduleName,
      filePath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
      method,
      endpointPath,
      methodName,
      summary,
      needsAuth,
      bodyDto,
      queryDto,
      expectedStatus,
    });
  }

  return endpoints;
}

function getBodyForEndpoint(endpoint) {
  const specialKey = `${endpoint.method} ${endpoint.endpointPath}`;
  const special = SPECIAL_BODIES[specialKey];
  if (special !== undefined) return special;

  if (endpoint.method === 'POST' && endpoint.endpointPath === '/files/upload') {
    return null;
  }
  if (
    endpoint.method === 'POST' &&
    endpoint.endpointPath === '/files/upload-multiple'
  ) {
    return null;
  }

  if (endpoint.bodyDto && DTO_EXAMPLES[endpoint.bodyDto]) {
    return DTO_EXAMPLES[endpoint.bodyDto];
  }

  return null;
}

function getQueryForEndpoint(endpoint) {
  if (!endpoint.queryDto) return [];
  const example = DTO_EXAMPLES[endpoint.queryDto];
  if (!example || typeof example !== 'object' || Array.isArray(example))
    return [];

  return Object.entries(example).map(([key, value]) => ({
    key,
    value: String(value),
    description: `Example ${key}`,
  }));
}

function getVarForParam(paramName, endpointPath) {
  if (paramName === 'slug' && endpointPath.startsWith('/products/'))
    return 'productSlug';
  if (paramName === 'slug' && endpointPath.startsWith('/categories/'))
    return 'categorySlug';
  if (paramName === 'id' && endpointPath.includes('/roles')) return 'roleId';
  if (paramName === 'id' && endpointPath.includes('/users')) return 'userId';
  if (paramName === 'id' && endpointPath.includes('/orders')) return 'orderId';
  if (paramName === 'id' && endpointPath.includes('/coupons'))
    return 'couponId';
  if (paramName === 'id' && endpointPath.includes('/addresses'))
    return 'addressId';
  if (paramName === 'id' && endpointPath.includes('/reviews'))
    return 'reviewId';
  if (paramName === 'id' && endpointPath.includes('/categories'))
    return 'categoryId';
  if (paramName === 'id' && endpointPath.includes('/cart/items'))
    return 'cartItemId';
  if (paramName === 'id' && endpointPath.includes('/products'))
    return 'productId';

  return VAR_BY_PARAM[paramName] || `${paramName}Value`;
}

function buildPostmanUrl(endpointPath, queryParams) {
  const params = [];
  const withVars = endpointPath.replace(/:([A-Za-z0-9_]+)/g, (_, p1) => {
    const varName = getVarForParam(p1, endpointPath);
    params.push({ key: p1, value: `{{${varName}}}` });
    return `{{${varName}}}`;
  });

  const raw = `{{baseUrl}}/api/v1${withVars}`;
  const pathParts = [
    'api',
    'v1',
    ...withVars.replace(/^\//, '').split('/').filter(Boolean),
  ];

  const url = {
    raw,
    host: ['{{baseUrl}}'],
    path: pathParts,
  };

  if (queryParams.length) {
    url.query = queryParams;
  }
  if (params.length) {
    url.variable = params;
  }

  return url;
}

function buildRequest(endpoint) {
  const queryParams = getQueryForEndpoint(endpoint);
  const body = getBodyForEndpoint(endpoint);
  const url = buildPostmanUrl(endpoint.endpointPath, queryParams);
  const isUpload =
    endpoint.endpointPath === '/files/upload' ||
    endpoint.endpointPath === '/files/upload-multiple';

  const description =
    endpoint.summary || `${endpoint.method} ${endpoint.endpointPath}`;

  const headers = [];
  if (endpoint.endpointPath === '/payments/webhook') {
    headers.push({ key: 'stripe-signature', value: '{{stripeSignature}}' });
    headers.push({ key: 'Content-Type', value: 'application/json' });
  } else if (!isUpload && body !== null) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }

  const request = {
    method: endpoint.method,
    header: headers,
    description,
    url,
  };

  if (endpoint.needsAuth) {
    request.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    };
  } else {
    request.auth = { type: 'noauth' };
  }

  if (isUpload) {
    if (endpoint.endpointPath === '/files/upload') {
      request.body = {
        mode: 'formdata',
        formdata: [{ key: 'file', type: 'file', src: [] }],
      };
    } else {
      request.body = {
        mode: 'formdata',
        formdata: [
          { key: 'files', type: 'file', src: [] },
          { key: 'files', type: 'file', src: [] },
        ],
      };
    }
  } else if (typeof body === 'string') {
    request.body = {
      mode: 'raw',
      raw: body,
      options: { raw: { language: 'json' } },
    };
  } else if (body !== null) {
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  const testScript = [
    `pm.test('Status is ${endpoint.expectedStatus}', function () {`,
    `  pm.response.to.have.status(${endpoint.expectedStatus});`,
    `});`,
  ];

  if (
    endpoint.endpointPath === '/auth/login' ||
    endpoint.endpointPath === '/auth/refresh'
  ) {
    testScript.push(
      `let json = {};`,
      `try { json = pm.response.json(); } catch (e) { json = {}; }`,
      `const payload = json.data || json;`,
      `if (payload.accessToken) pm.collectionVariables.set('accessToken', payload.accessToken);`,
      `if (payload.refreshToken) pm.collectionVariables.set('refreshToken', payload.refreshToken);`,
      `if (payload.user && payload.user.id) pm.collectionVariables.set('userId', payload.user.id);`,
    );
  }

  return {
    name: `${endpoint.method} ${endpoint.endpointPath}`,
    request,
    response: [],
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: testScript,
        },
      },
    ],
  };
}

function toTitleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildCollection(endpoints) {
  const grouped = new Map();

  for (const ep of endpoints) {
    if (!grouped.has(ep.moduleName)) grouped.set(ep.moduleName, []);
    grouped.get(ep.moduleName).push(ep);
  }

  const folders = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleName, items]) => {
      const sorted = items.sort((a, b) => {
        const pa = `${a.endpointPath}:${a.method}`;
        const pb = `${b.endpointPath}:${b.method}`;
        return pa.localeCompare(pb);
      });

      return {
        name: toTitleCase(moduleName),
        item: sorted.map(buildRequest),
      };
    });

  return {
    info: {
      name: 'Ecommerce Backend API (Auto Generated)',
      _postman_id: '8f8a1607-4f6d-4da5-bbde-ec9e6478e400',
      description:
        'Auto-generated from NestJS controllers under src/**/*.controller.ts. Includes route descriptions and test-ready sample payloads.',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000' },
      { key: 'accessToken', value: '' },
      { key: 'refreshToken', value: '' },
      { key: 'id', value: '550e8400-e29b-41d4-a716-446655440000' },
      { key: 'userId', value: '550e8400-e29b-41d4-a716-446655440001' },
      { key: 'roleId', value: '550e8400-e29b-41d4-a716-446655440002' },
      { key: 'permissionId', value: '550e8400-e29b-41d4-a716-446655440003' },
      {
        key: 'secondPermissionId',
        value: '550e8400-e29b-41d4-a716-446655440004',
      },
      { key: 'productId', value: '550e8400-e29b-41d4-a716-446655440005' },
      { key: 'categoryId', value: '550e8400-e29b-41d4-a716-446655440006' },
      {
        key: 'parentCategoryId',
        value: '550e8400-e29b-41d4-a716-446655440007',
      },
      { key: 'orderId', value: '550e8400-e29b-41d4-a716-446655440008' },
      { key: 'couponId', value: '550e8400-e29b-41d4-a716-446655440009' },
      { key: 'addressId', value: '550e8400-e29b-41d4-a716-446655440010' },
      {
        key: 'billingAddressId',
        value: '550e8400-e29b-41d4-a716-446655440011',
      },
      { key: 'reviewId', value: '550e8400-e29b-41d4-a716-446655440012' },
      { key: 'imageId', value: '550e8400-e29b-41d4-a716-446655440013' },
      { key: 'secondImageId', value: '550e8400-e29b-41d4-a716-446655440014' },
      { key: 'cartItemId', value: '550e8400-e29b-41d4-a716-446655440015' },
      { key: 'productSlug', value: 'iphone-15-pro' },
      { key: 'categorySlug', value: 'electronics' },
      { key: 'slug', value: 'sample-slug' },
      { key: 'couponCode', value: 'SUMMER20' },
      { key: 'uploadedFilePath', value: 'uploads/products/example-image.jpg' },
      { key: 'stripeSignature', value: 't=1700000000,v1=test_signature' },
      { key: 'orderIdempotencySuffix', value: '20260315-1001' },
    ],
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('Response time < 5000ms', function () {",
            '  pm.expect(pm.response.responseTime).to.be.below(5000);',
            '});',
          ],
        },
      },
    ],
    item: folders,
  };
}

function main() {
  const controllerFiles = listControllerFiles(SRC_DIR);
  const endpoints = controllerFiles.flatMap((file) => {
    const content = fs.readFileSync(file, 'utf8');
    return parseController(content, file);
  });

  const unique = new Map();
  for (const ep of endpoints) {
    const key = `${ep.method} ${ep.endpointPath}`;
    if (!unique.has(key)) unique.set(key, ep);
  }

  const deduped = Array.from(unique.values());
  const collection = buildCollection(deduped);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(collection, null, 2) + '\n',
    'utf8',
  );

  console.log(
    `Generated ${deduped.length} endpoints to ${path.relative(ROOT, OUTPUT_FILE)}`,
  );
}

main();
