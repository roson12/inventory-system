export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: string;
  customer: {
    id: string;
    companyName?: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  warehouses: WarehouseRef[];
  permissions: string[];
  mustChangePassword: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unitOfMeasure: string;
  sellingPrice: string;
  reorderLevel: string;
  isActive: boolean;
  available: string;
  onHand?: string;
  costPrice?: string;
  category: { id: string; name: string } | null;
  images: { id: string; url: string; altText: string | null; isPrimary: boolean }[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
  lineTotal: string;
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  currencyCode: string;
  shippingName: string;
  shippingPhone: string | null;
  shippingAddress: string;
  notes: string | null;
  cancelReason?: string | null;
  placedAt: string;
  confirmedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  warehouse?: WarehouseRef | null;
  customer: { id: string; name: string; email: string; phone?: string | null };
  items: OrderItem[];
  reservations?: { id: string; quantity: string; status: string; warehouseId: string }[];
}

export interface InventoryBalance {
  id: string;
  product: { id: string; name: string; sku: string; unitOfMeasure: string; reorderLevel: string; sellingPrice: string; costPrice: string };
  warehouse: WarehouseRef;
  onHand: string;
  reserved: string;
  available: string;
  avgCost: string;
  value: string;
  isLowStock: boolean;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  type: string;
  quantity: string;
  unitCost: string;
  balanceAfter: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string; unitOfMeasure: string };
  warehouse: WarehouseRef;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  locations?: { id: string; code: string; name: string | null }[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  _count?: { products: number };
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  products?: { id: string; unitCost?: string; supplierSku: string | null; product: { id: string; name: string; sku: string } }[];
  purchaseOrders?: { id: string; poNumber: string; status: string; total: string; createdAt: string }[];
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  approvalRequired: boolean;
  notes: string | null;
  expectedAt: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
  warehouse: WarehouseRef;
  createdBy?: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    quantity: string;
    receivedQty: string;
    unitCost: string;
    taxRate: string;
    lineTotal: string;
    product: { id: string; name: string; sku: string; unitOfMeasure?: string };
  }[];
  receipts?: GoodsReceipt[];
}

export interface GoodsReceipt {
  id: string;
  receiptNumber: string;
  receivedAt: string;
  notes: string | null;
  purchaseOrder?: { id: string; poNumber: string; status: string };
  warehouse?: WarehouseRef;
  receivedBy?: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    quantity: string;
    unitCost: string;
    product: { id: string; name: string; sku: string };
  }[];
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  status: string;
  reason: string;
  refundAmount: string;
  requestedAt: string;
  receivedAt: string | null;
  order: { id: string; orderNumber: string; status: string };
  customer?: { id: string; name: string; email: string };
  items: {
    id: string;
    orderItemId: string;
    quantity: string;
    unitPrice: string;
    restock: boolean;
    product: { id: string; name: string; sku: string };
  }[];
}

export interface Adjustment {
  id: string;
  adjustmentNumber: string;
  kind: string;
  quantity: string;
  unitCost: string | null;
  reason: string;
  status: string;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  warehouse: WarehouseRef;
  requestedBy?: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
}

export interface Transfer {
  id: string;
  transferNumber: string;
  status: string;
  notes: string | null;
  createdAt: string;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  requestedBy?: { id: string; name: string };
  items: { id: string; quantity: string; unitCost: string; product: { id: string; name: string; sku: string } }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  warehouseAssignments?: { warehouse: WarehouseRef }[];
}

export interface Settings {
  companyName: string;
  currencyCode: string;
  allowNegativeStock: boolean;
  purchaseApprovalLimit: string;
  taxEnabled: boolean;
  defaultTaxRate: string;
  lowStockNotifications: boolean;
}

export interface Summary {
  activeProducts: number;
  activeWarehouses: number;
  pendingOrders: number;
  pendingPurchaseOrders: number;
  lowStockCount: number;
  lowStock: { productId: string; warehouseId: string; name: string; sku: string; onHand: string; reorderLevel: string }[];
  inventoryValue?: string;
  salesLast30Days?: string;
  ordersLast30Days?: number;
  recentOrders: { id: string; orderNumber: string; status: string; total: string; placedAt: string; customer: { name: string } }[];
}
