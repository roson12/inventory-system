import { Role } from '@prisma/client';

export const PERMISSIONS = {
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  PRODUCTS_ARCHIVE: 'products.archive',
  CATEGORIES_WRITE: 'categories.write',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_ADJUST_REQUEST: 'inventory.adjust.request',
  INVENTORY_TRANSFER: 'inventory.transfer',
  WAREHOUSES_READ: 'warehouses.read',
  WAREHOUSES_WRITE: 'warehouses.write',
  SUPPLIERS_READ: 'suppliers.read',
  SUPPLIERS_WRITE: 'suppliers.write',
  SUPPLIER_COSTS_READ: 'suppliers.costs.read',
  PURCHASE_ORDERS_READ: 'purchase_orders.read',
  PURCHASE_ORDERS_WRITE: 'purchase_orders.write',
  PURCHASE_ORDERS_APPROVE: 'purchase_orders.approve',
  PURCHASE_ORDERS_APPROVE_UNLIMITED: 'purchase_orders.approve_unlimited',
  GOODS_RECEIPTS_CREATE: 'goods_receipts.create',
  ORDERS_CREATE: 'orders.create',
  ORDERS_READ_ALL: 'orders.read_all',
  ORDERS_READ_ASSIGNED: 'orders.read_assigned',
  ORDERS_CONFIRM: 'orders.confirm',
  ORDERS_PROCESS: 'orders.process',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_MARK_PAID: 'orders.mark_paid',
  RETURNS_MANAGE: 'returns.manage',
  CUSTOMERS_READ: 'customers.read',
  USERS_READ: 'users.read',
  USERS_MANAGE_STAFF: 'users.manage_staff',
  USERS_MANAGE_ADMIN: 'users.manage_admin',
  USERS_MANAGE_SUPER_ADMIN: 'users.manage_super_admin',
  ROLES_MANAGE: 'roles.manage',
  REPORTS_VIEW: 'reports.view',
  REPORTS_FINANCIAL: 'reports.financial',
  AUDIT_READ: 'audit.read',
  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',
  NOTIFICATIONS_READ: 'notifications.read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

interface PermissionDefinition {
  key: PermissionKey;
  description: string;
  category: string;
}

const def = (key: PermissionKey, category: string, description: string): PermissionDefinition => ({
  key,
  category,
  description,
});

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  def(PERMISSIONS.PRODUCTS_READ, 'Catalog', 'View products and stock availability'),
  def(PERMISSIONS.PRODUCTS_WRITE, 'Catalog', 'Create and edit products'),
  def(PERMISSIONS.PRODUCTS_ARCHIVE, 'Catalog', 'Archive products'),
  def(PERMISSIONS.CATEGORIES_WRITE, 'Catalog', 'Create and edit categories'),
  def(PERMISSIONS.INVENTORY_READ, 'Inventory', 'View inventory balances and stock movements'),
  def(PERMISSIONS.INVENTORY_ADJUST, 'Inventory', 'Apply or approve stock adjustments'),
  def(PERMISSIONS.INVENTORY_ADJUST_REQUEST, 'Inventory', 'Request a stock adjustment'),
  def(PERMISSIONS.INVENTORY_TRANSFER, 'Inventory', 'Create and complete warehouse transfers'),
  def(PERMISSIONS.WAREHOUSES_READ, 'Inventory', 'View warehouses'),
  def(PERMISSIONS.WAREHOUSES_WRITE, 'Inventory', 'Create and edit warehouses'),
  def(PERMISSIONS.SUPPLIERS_READ, 'Procurement', 'View suppliers'),
  def(PERMISSIONS.SUPPLIERS_WRITE, 'Procurement', 'Create and edit suppliers'),
  def(PERMISSIONS.SUPPLIER_COSTS_READ, 'Procurement', 'View supplier costs and margins'),
  def(PERMISSIONS.PURCHASE_ORDERS_READ, 'Procurement', 'View purchase orders'),
  def(PERMISSIONS.PURCHASE_ORDERS_WRITE, 'Procurement', 'Create and submit purchase orders'),
  def(PERMISSIONS.PURCHASE_ORDERS_APPROVE, 'Procurement', 'Approve purchase orders'),
  def(
    PERMISSIONS.PURCHASE_ORDERS_APPROVE_UNLIMITED,
    'Procurement',
    'Approve purchase orders above the configured limit',
  ),
  def(PERMISSIONS.GOODS_RECEIPTS_CREATE, 'Procurement', 'Record goods receipts'),
  def(PERMISSIONS.ORDERS_CREATE, 'Sales', 'Create customer orders'),
  def(PERMISSIONS.ORDERS_READ_ALL, 'Sales', 'View all customer orders'),
  def(PERMISSIONS.ORDERS_READ_ASSIGNED, 'Sales', 'View orders in assigned warehouses'),
  def(PERMISSIONS.ORDERS_CONFIRM, 'Sales', 'Confirm orders and reserve stock'),
  def(PERMISSIONS.ORDERS_PROCESS, 'Sales', 'Advance order fulfillment states'),
  def(PERMISSIONS.ORDERS_CANCEL, 'Sales', 'Cancel orders'),
  def(PERMISSIONS.ORDERS_MARK_PAID, 'Sales', 'Record payment against an order'),
  def(PERMISSIONS.RETURNS_MANAGE, 'Sales', 'Approve and receive returns'),
  def(PERMISSIONS.CUSTOMERS_READ, 'Customers', 'View customer records'),
  def(PERMISSIONS.USERS_READ, 'Administration', 'View user accounts'),
  def(PERMISSIONS.USERS_MANAGE_STAFF, 'Administration', 'Create and manage staff accounts'),
  def(PERMISSIONS.USERS_MANAGE_ADMIN, 'Administration', 'Create and manage admin accounts'),
  def(
    PERMISSIONS.USERS_MANAGE_SUPER_ADMIN,
    'Administration',
    'Create and manage super admin accounts',
  ),
  def(PERMISSIONS.ROLES_MANAGE, 'Administration', 'Manage role permissions and user overrides'),
  def(PERMISSIONS.REPORTS_VIEW, 'Reports', 'View operational reports'),
  def(PERMISSIONS.REPORTS_FINANCIAL, 'Reports', 'View valuation, cost, and profit reports'),
  def(PERMISSIONS.AUDIT_READ, 'Audit', 'View audit logs'),
  def(PERMISSIONS.SETTINGS_READ, 'Settings', 'View system settings'),
  def(PERMISSIONS.SETTINGS_MANAGE, 'Settings', 'Change system settings'),
  def(PERMISSIONS.NOTIFICATIONS_READ, 'Notifications', 'View in-app notifications'),
];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

type RoleDefaults = Record<Role, PermissionKey[]>;

export const DEFAULT_ROLE_PERMISSIONS: RoleDefaults = {
  CUSTOMER: [PERMISSIONS.PRODUCTS_READ, PERMISSIONS.ORDERS_CREATE],
  STAFF: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_ADJUST_REQUEST,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.WAREHOUSES_READ,
    PERMISSIONS.PURCHASE_ORDERS_READ,
    PERMISSIONS.GOODS_RECEIPTS_CREATE,
    PERMISSIONS.ORDERS_READ_ASSIGNED,
    PERMISSIONS.ORDERS_PROCESS,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],
  ADMIN: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.PRODUCTS_ARCHIVE,
    PERMISSIONS.CATEGORIES_WRITE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.WAREHOUSES_READ,
    PERMISSIONS.SUPPLIERS_READ,
    PERMISSIONS.SUPPLIERS_WRITE,
    PERMISSIONS.SUPPLIER_COSTS_READ,
    PERMISSIONS.PURCHASE_ORDERS_READ,
    PERMISSIONS.PURCHASE_ORDERS_WRITE,
    PERMISSIONS.PURCHASE_ORDERS_APPROVE,
    PERMISSIONS.GOODS_RECEIPTS_CREATE,
    PERMISSIONS.ORDERS_READ_ALL,
    PERMISSIONS.ORDERS_CONFIRM,
    PERMISSIONS.ORDERS_PROCESS,
    PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.ORDERS_MARK_PAID,
    PERMISSIONS.RETURNS_MANAGE,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_FINANCIAL,
    PERMISSIONS.SETTINGS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],
  SUPER_ADMIN: ALL_PERMISSIONS,
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as string[]).includes(value);
}
