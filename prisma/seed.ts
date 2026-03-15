import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Permission definitions ───────────────────────────────────────────────────

const SUBJECTS = [
  'product',
  'category',
  'order',
  'user',
  'review',
  'coupon',
  'analytics',
  'role',
] as const;

const ACTIONS = ['create', 'read', 'update', 'delete'] as const;

type PermissionDef = { action: string; subject: string; description?: string };

function buildPermissions(): PermissionDef[] {
  const perms: PermissionDef[] = [];

  for (const subject of SUBJECTS) {
    for (const action of ACTIONS) {
      perms.push({
        action,
        subject,
        description: `Can ${action} ${subject}`,
      });
    }
  }

  // Special permissions
  perms.push({
    action: 'manage',
    subject: 'all',
    description: 'Full access to everything',
  });
  perms.push({
    action: 'read',
    subject: 'order-own',
    description: 'Can read own orders only',
  });
  perms.push({
    action: 'manage',
    subject: 'cart',
    description: 'Can manage own cart',
  });
  perms.push({
    action: 'manage',
    subject: 'wishlist',
    description: 'Can manage own wishlist',
  });
  perms.push({
    action: 'manage',
    subject: 'address',
    description: 'Can manage own addresses',
  });

  return perms;
}

// ─── Role permission maps ──────────────────────────────────────────────────────

const ADMIN_PERMISSION_PAIRS: [string, string][] = [
  // Products
  ['create', 'product'],
  ['read', 'product'],
  ['update', 'product'],
  ['delete', 'product'],
  // Categories
  ['create', 'category'],
  ['read', 'category'],
  ['update', 'category'],
  ['delete', 'category'],
  // Orders
  ['create', 'order'],
  ['read', 'order'],
  ['update', 'order'],
  ['delete', 'order'],
  // Reviews
  ['create', 'review'],
  ['read', 'review'],
  ['update', 'review'],
  ['delete', 'review'],
  // Coupons
  ['create', 'coupon'],
  ['read', 'coupon'],
  ['update', 'coupon'],
  ['delete', 'coupon'],
  // Analytics
  ['create', 'analytics'],
  ['read', 'analytics'],
  ['update', 'analytics'],
  ['delete', 'analytics'],
  // Roles (read only — no user management for ADMIN)
  ['read', 'role'],
];

const CUSTOMER_PERMISSION_PAIRS: [string, string][] = [
  ['read', 'product'],
  ['create', 'order'],
  ['create', 'review'],
  ['read', 'order-own'],
  ['manage', 'cart'],
  ['manage', 'wishlist'],
  ['manage', 'address'],
];

// ─── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_CATEGORIES = [
  {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Electronic devices and accessories',
    sortOrder: 1,
  },
  {
    name: 'Clothing',
    slug: 'clothing',
    description: 'Fashion and apparel',
    sortOrder: 2,
  },
  {
    name: 'Books',
    slug: 'books',
    description: 'Physical and digital books',
    sortOrder: 3,
  },
  {
    name: 'Home & Garden',
    slug: 'home-garden',
    description: 'Home decor and garden supplies',
    sortOrder: 4,
  },
];

const SAMPLE_PRODUCTS = [
  {
    name: 'Wireless Bluetooth Headphones',
    slug: 'wireless-bluetooth-headphones',
    description:
      'High-quality wireless headphones with noise cancellation and 30-hour battery life.',
    shortDescription: 'Premium wireless headphones with ANC',
    price: '79.99',
    compareAtPrice: '129.99',
    costPrice: '35.00',
    sku: 'ELEC-WBH-001',
    stock: 150,
    lowStockThreshold: 10,
    weight: '0.350',
    isFeatured: true,
    categorySlug: 'electronics',
  },
  {
    name: 'USB-C Fast Charger 65W',
    slug: 'usb-c-fast-charger-65w',
    description:
      'Universal 65W USB-C fast charger compatible with laptops, tablets, and phones.',
    shortDescription: '65W USB-C GaN fast charger',
    price: '34.99',
    compareAtPrice: null,
    costPrice: '12.00',
    sku: 'ELEC-UCH-001',
    stock: 300,
    lowStockThreshold: 20,
    weight: '0.120',
    isFeatured: false,
    categorySlug: 'electronics',
  },
  {
    name: 'Classic Cotton T-Shirt',
    slug: 'classic-cotton-t-shirt',
    description:
      '100% organic cotton t-shirt, available in multiple colors. Comfortable everyday wear.',
    shortDescription: '100% organic cotton tee',
    price: '24.99',
    compareAtPrice: null,
    costPrice: '8.00',
    sku: 'CLO-CTS-001',
    stock: 500,
    lowStockThreshold: 30,
    weight: '0.200',
    isFeatured: false,
    categorySlug: 'clothing',
  },
  {
    name: 'The Pragmatic Programmer',
    slug: 'the-pragmatic-programmer',
    description:
      'Your journey to mastery — the 20th anniversary edition. Essential reading for every developer.',
    shortDescription: 'Classic programming book, 20th anniversary',
    price: '49.99',
    compareAtPrice: '59.99',
    costPrice: '22.00',
    sku: 'BOOK-PP-001',
    stock: 75,
    lowStockThreshold: 5,
    weight: '0.550',
    isFeatured: true,
    categorySlug: 'books',
  },
];

// ─── Seeder ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting database seed...\n');

  // 1. Upsert all permissions
  console.log('Creating permissions...');
  const permissionDefs = buildPermissions();
  for (const perm of permissionDefs) {
    await prisma.permission.upsert({
      where: { action_subject: { action: perm.action, subject: perm.subject } },
      update: { description: perm.description },
      create: perm,
    });
  }
  console.log(`  ✓ ${permissionDefs.length} permissions upserted`);

  // 2. Upsert roles
  console.log('Creating roles...');

  const superAdminRole = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: { description: 'Full access to everything' },
    create: { name: 'SUPER_ADMIN', description: 'Full access to everything' },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {
      description:
        'Store administrator with full product/order/content management',
    },
    create: {
      name: 'ADMIN',
      description:
        'Store administrator with full product/order/content management',
    },
  });

  const customerRole = await prisma.role.upsert({
    where: { name: 'CUSTOMER' },
    update: { description: 'Regular customer with shopping capabilities' },
    create: {
      name: 'CUSTOMER',
      description: 'Regular customer with shopping capabilities',
    },
  });

  console.log('  ✓ 3 roles upserted (SUPER_ADMIN, ADMIN, CUSTOMER)');

  // 3. Assign permissions to SUPER_ADMIN (manage:all)
  console.log('Assigning permissions to roles...');
  const superPerm = await prisma.permission.findUniqueOrThrow({
    where: { action_subject: { action: 'manage', subject: 'all' } },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: superAdminRole.id,
        permissionId: superPerm.id,
      },
    },
    update: {},
    create: { roleId: superAdminRole.id, permissionId: superPerm.id },
  });

  // 4. Assign permissions to ADMIN
  for (const [action, subject] of ADMIN_PERMISSION_PAIRS) {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { action_subject: { action, subject } },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // 5. Assign permissions to CUSTOMER
  for (const [action, subject] of CUSTOMER_PERMISSION_PAIRS) {
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { action_subject: { action, subject } },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: customerRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: customerRole.id, permissionId: perm.id },
    });
  }

  console.log('  ✓ Permissions assigned to all roles');

  console.log('Creating default admin & standard users...');
  const defaultPassword = await bcrypt.hash('Password@123', 12);

  // 6a. Super Admin
  const adminUser = await prisma.user.upsert({
    where: { email: 'superadmin@ecommerce.com' },
    update: {},
    create: {
      email: 'superadmin@ecommerce.com',
      password: defaultPassword,
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: adminUser.id, roleId: superAdminRole.id },
    },
    update: {},
    create: { userId: adminUser.id, roleId: superAdminRole.id },
  });

  console.log(
    '  ✓ Super Admin user: superadmin@ecommerce.com (password: Password@123)',
  );

  // 6b. Standard Admin
  const standardAdminUser = await prisma.user.upsert({
    where: { email: 'admin@ecommerce.com' },
    update: {},
    create: {
      email: 'admin@ecommerce.com',
      password: defaultPassword,
      firstName: 'Store',
      lastName: 'Admin',
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: standardAdminUser.id, roleId: adminRole.id },
    },
    update: {},
    create: { userId: standardAdminUser.id, roleId: adminRole.id },
  });

  console.log(
    '  ✓ Store Admin user: admin@ecommerce.com (password: Password@123)',
  );

  // 6c. Standard Customer
  const normalCustomer = await prisma.user.upsert({
    where: { email: 'customer@ecommerce.com' },
    update: {},
    create: {
      email: 'customer@ecommerce.com',
      password: defaultPassword,
      firstName: 'John',
      lastName: 'Doe',
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: normalCustomer.id, roleId: customerRole.id },
    },
    update: {},
    create: { userId: normalCustomer.id, roleId: customerRole.id },
  });

  console.log(
    '  ✓ Customer user: customer@ecommerce.com (password: Password@123)',
  );

  // 7. Create sample categories
  console.log('Creating sample categories...');
  const categoryMap = new Map<string, string>(); // slug → id

  for (const cat of SAMPLE_CATEGORIES) {
    const created = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
      },
      create: cat,
    });
    categoryMap.set(cat.slug, created.id);
  }

  console.log(`  ✓ ${SAMPLE_CATEGORIES.length} categories upserted`);

  // 8. Create sample products
  console.log('Creating sample products...');

  for (const prod of SAMPLE_PRODUCTS) {
    const { categorySlug, ...productData } = prod;
    const categoryId = categoryMap.get(categorySlug)!;

    await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {
        name: productData.name,
        description: productData.description,
        shortDescription: productData.shortDescription,
        price: productData.price,
        compareAtPrice: productData.compareAtPrice ?? undefined,
        costPrice: productData.costPrice,
        stock: productData.stock,
        isFeatured: productData.isFeatured,
        categoryId,
      },
      create: {
        ...productData,
        compareAtPrice: productData.compareAtPrice ?? undefined,
        categoryId,
      },
    });
  }

  console.log(`  ✓ ${SAMPLE_PRODUCTS.length} products upserted`);

  console.log('\n✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
