import argon2 from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { env } from '../src/config/env';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../src/lib/permissions';
import { applyMovement, ensureSettings } from '../src/services/inventory';
import { createInitialSuperAdmin } from '../src/services/bootstrap';

async function seedPermissions() {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { description: permission.description, category: permission.category },
    });
  }

  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [
    Role,
    (typeof DEFAULT_ROLE_PERMISSIONS)[Role],
  ][]) {
    for (const permissionKey of permissions) {
      await prisma.rolePermission.upsert({
        where: { role_permissionKey: { role, permissionKey } },
        create: { role, permissionKey },
        update: {},
      });
    }
  }
}

async function upsertUser(input: {
  email: string;
  name: string;
  role: Role;
  password: string;
  phone?: string;
}) {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      phone: input.phone,
      ...(input.role === 'CUSTOMER' ? { customer: { create: { phone: input.phone } } } : {}),
    },
    update: { name: input.name, role: input.role, passwordHash, status: 'ACTIVE' },
  });
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('[seed] permissions and role defaults');
  await seedPermissions();
  const settings = await ensureSettings();
  // eslint-disable-next-line no-console
  console.log(`[seed] settings ready (currency ${settings.currencyCode})`);

  // The first Super Admin is created once, and never overwritten by a later
  // seed run. Additional Super Admins must be created by an existing one.
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { email: true },
  });
  let superAdminEmail = existingSuperAdmin?.email;
  if (existingSuperAdmin) {
    // eslint-disable-next-line no-console
    console.log(`[seed] Super Admin already exists (${existingSuperAdmin.email}); skipping bootstrap`);
  } else if (!env.BOOTSTRAP_SUPER_ADMIN_EMAIL || !env.BOOTSTRAP_SUPER_ADMIN_PASSWORD) {
    // eslint-disable-next-line no-console
    console.log(
      '[seed] no Super Admin configured; set BOOTSTRAP_SUPER_ADMIN_EMAIL/PASSWORD or run `npm run create-super-admin`',
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('[seed] creating initial Super Admin');
    const created = await createInitialSuperAdmin({
      email: env.BOOTSTRAP_SUPER_ADMIN_EMAIL,
      name: env.BOOTSTRAP_SUPER_ADMIN_NAME,
      password: env.BOOTSTRAP_SUPER_ADMIN_PASSWORD,
    });
    superAdminEmail = created.email;
  }

  if (!env.SEED_DEMO_DATA) {
    // eslint-disable-next-line no-console
    console.log('[seed] demo data disabled');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[seed] demo users');
  const admin = await upsertUser({
    email: 'admin@example.com',
    name: 'Avery Admin',
    role: 'ADMIN',
    password: 'Admin123!Pass',
  });
  const staff = await upsertUser({
    email: 'staff@example.com',
    name: 'Sam Staff',
    role: 'STAFF',
    password: 'Staff123!Pass',
  });
  const customer = await upsertUser({
    email: 'customer@example.com',
    name: 'Casey Customer',
    role: 'CUSTOMER',
    password: 'Customer123!Pass',
    phone: '+1 555 0100',
  });
  await prisma.customer.upsert({
    where: { userId: customer.id },
    create: {
      userId: customer.id,
      phone: '+1 555 0100',
      addressLine1: '12 Market Street',
      city: 'Springfield',
      country: 'US',
    },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.log('[seed] warehouses');
  const main = await prisma.warehouse.upsert({
    where: { code: 'WH-MAIN' },
    create: { code: 'WH-MAIN', name: 'Main Warehouse', address: '1 Industrial Way' },
    update: {},
  });
  const secondary = await prisma.warehouse.upsert({
    where: { code: 'WH-SECONDARY' },
    create: { code: 'WH-SECONDARY', name: 'Secondary Warehouse', address: '9 Depot Road' },
    update: {},
  });

  await prisma.userWarehouseAssignment.upsert({
    where: { userId_warehouseId: { userId: staff.id, warehouseId: main.id } },
    create: { userId: staff.id, warehouseId: main.id },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.log('[seed] categories and products');
  const electronics = await prisma.category.upsert({
    where: { slug: 'electronics' },
    create: { name: 'Electronics', slug: 'electronics' },
    update: {},
  });
  const accessories = await prisma.category.upsert({
    where: { slug: 'accessories' },
    create: { name: 'Accessories', slug: 'accessories', parentId: electronics.id },
    update: { parentId: electronics.id },
  });
  await prisma.category.upsert({
    where: { slug: 'office-supplies' },
    create: { name: 'Office Supplies', slug: 'office-supplies' },
    update: {},
  });

  const productSeed = [
    { sku: 'ELEC-001', name: 'Wireless Keyboard', categoryId: electronics.id, cost: 22, price: 49.9, reorder: 10, qtyMain: 40, qtySecondary: 12 },
    { sku: 'ELEC-002', name: 'USB-C Monitor 27"', categoryId: electronics.id, cost: 180, price: 329, reorder: 5, qtyMain: 15, qtySecondary: 4 },
    { sku: 'ELEC-003', name: 'Noise-Cancelling Headphones', categoryId: electronics.id, cost: 95, price: 189, reorder: 8, qtyMain: 25, qtySecondary: 6 },
    { sku: 'ACC-001', name: 'Braided USB-C Cable 2m', categoryId: accessories.id, cost: 4.5, price: 14.99, reorder: 25, qtyMain: 120, qtySecondary: 60 },
    { sku: 'ACC-002', name: 'Laptop Sleeve 14"', categoryId: accessories.id, cost: 11, price: 29.5, reorder: 15, qtyMain: 30, qtySecondary: 10 },
    { sku: 'OFF-001', name: 'A4 Copy Paper (500 sheets)', categoryId: null, cost: 3.2, price: 7.99, reorder: 50, qtyMain: 200, qtySecondary: 150 },
  ];

  for (const seed of productSeed) {
    const existing = await prisma.product.findUnique({ where: { sku: seed.sku } });
    if (existing) continue;
    const product = await prisma.product.create({
      data: {
        sku: seed.sku,
        name: seed.name,
        categoryId: seed.categoryId,
        costPrice: new Prisma.Decimal(seed.cost.toFixed(2)),
        sellingPrice: new Prisma.Decimal(seed.price.toFixed(2)),
        reorderLevel: new Prisma.Decimal(seed.reorder.toFixed(3)),
        unitOfMeasure: 'unit',
        createdById: admin.id,
      },
    });

    for (const [warehouse, quantity] of [
      [main, seed.qtyMain],
      [secondary, seed.qtySecondary],
    ] as const) {
      await prisma.$transaction(async (tx) => {
        await applyMovement(
          tx,
          {
            productId: product.id,
            warehouseId: warehouse.id,
            type: 'OPENING',
            quantity: new Prisma.Decimal(quantity),
            unitCost: new Prisma.Decimal(seed.cost.toFixed(2)),
            reason: 'Seed opening stock',
            actorId: admin.id,
          },
          { allowNegativeStock: false },
        );
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log('[seed] suppliers and a purchase order');
  const supplier = await prisma.supplier.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Northwind Components',
      contactName: 'Riley Chen',
      email: 'sales@northwind.example',
      phone: '+1 555 0110',
      address: '400 Supply Ave',
    },
    update: {},
  });
  await prisma.supplierProduct.upsert({
    where: { supplierId_productId: { supplierId: supplier.id, productId: (await prisma.product.findUniqueOrThrow({ where: { sku: 'ELEC-001' } })).id } },
    create: {
      supplierId: supplier.id,
      productId: (await prisma.product.findUniqueOrThrow({ where: { sku: 'ELEC-001' } })).id,
      supplierSku: 'NW-KB-1',
      unitCost: 21.5,
      leadTimeDays: 7,
    },
    update: {},
  });

  const keyboard = await prisma.product.findUniqueOrThrow({ where: { sku: 'ELEC-001' } });
  const existingPo = await prisma.purchaseOrder.findFirst({ where: { supplierId: supplier.id } });
  if (!existingPo) {
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-SEED-${Date.now()}`,
        supplierId: supplier.id,
        warehouseId: main.id,
        status: 'APPROVED',
        subtotal: new Prisma.Decimal(645),
        taxTotal: new Prisma.Decimal(0),
        total: new Prisma.Decimal(645),
        approvalRequired: false,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(),
        items: {
          create: [
            {
              productId: keyboard.id,
              quantity: new Prisma.Decimal(30),
              unitCost: new Prisma.Decimal(21.5),
              lineTotal: new Prisma.Decimal(645),
            },
          ],
        },
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] a pending customer order');
  const existingOrder = await prisma.customerOrder.findFirst({ where: { customerId: customer.id } });
  if (!existingOrder) {
    const cable = await prisma.product.findUniqueOrThrow({ where: { sku: 'ACC-001' } });
    await prisma.customerOrder.create({
      data: {
        orderNumber: `ORD-SEED-${Date.now()}`,
        customerId: customer.id,
        status: 'PENDING',
        subtotal: new Prisma.Decimal(29.98),
        taxTotal: new Prisma.Decimal(0),
        total: new Prisma.Decimal(29.98),
        currencyCode: settings.currencyCode,
        shippingName: customer.name,
        shippingPhone: '+1 555 0100',
        shippingAddress: '12 Market Street, Springfield',
        items: {
          create: [
            {
              productId: cable.id,
              productName: cable.name,
              sku: cable.sku,
              quantity: new Prisma.Decimal(2),
              unitPrice: new Prisma.Decimal(14.99),
              lineTotal: new Prisma.Decimal(29.98),
            },
          ],
        },
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] complete');
  // eslint-disable-next-line no-console
  console.log(
    `[seed] sign in: ${superAdminEmail ?? 'Super Admin configured via create-super-admin'}, admin@example.com, staff@example.com, customer@example.com`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
