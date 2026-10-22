export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Inventory Management System API',
    version: '1.0.0',
    description:
      'REST API for the multi-warehouse inventory system. All state-changing requests require the x-csrf-token header. Authentication uses the ims.sid HttpOnly session cookie.',
  },
  servers: [{ url: '/api', description: 'Current origin' }],
  tags: [
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'Roles' },
    { name: 'Products' },
    { name: 'Categories' },
    { name: 'Inventory' },
    { name: 'Warehouses' },
    { name: 'Suppliers' },
    { name: 'Purchase Orders' },
    { name: 'Goods Receipts' },
    { name: 'Orders' },
    { name: 'Returns' },
    { name: 'Reports' },
    { name: 'Notifications' },
    { name: 'Audit Logs' },
    { name: 'Settings' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'ims.sid' },
      csrfHeader: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
        },
      },
      Paginated: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'object' } },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/auth/csrf': {
      get: {
        tags: ['Auth'],
        summary: 'Issue a CSRF token bound to the current session',
        security: [],
        responses: { '200': { description: 'Token' } },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a Customer account (public registration cannot create other roles)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 10 },
                  phone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Customer created and signed in' }, '409': { description: 'Email exists' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in and create a server-side session',
        security: [],
        responses: {
          '200': { description: 'Signed in' },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Destroy the current session', responses: { '204': { description: 'Signed out' } } },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user, permissions, and warehouses', responses: { '200': { description: 'Profile' } } },
    },
    '/auth/password/forgot': {
      post: { tags: ['Auth'], summary: 'Request a password reset link', security: [], responses: { '200': { description: 'Accepted' } } },
    },
    '/auth/password/reset': {
      post: { tags: ['Auth'], summary: 'Reset a password with a single-use token', security: [], responses: { '200': { description: 'Password updated' } } },
    },
    '/users': {
      get: { tags: ['Users'], summary: 'List users (users.read)', responses: { '200': { description: 'Paginated users' } } },
      post: { tags: ['Users'], summary: 'Provision a user (role-specific permission required)', responses: { '201': { description: 'Created' } } },
    },
    '/users/{id}': {
      patch: { tags: ['Users'], summary: 'Update a user; only Super Admin may change roles', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
    },
    '/users/{id}/permissions': {
      put: { tags: ['Users'], summary: 'Replace per-user permission overrides (roles.manage)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
    },
    '/roles': {
      get: { tags: ['Roles'], summary: 'List roles and effective permissions', responses: { '200': { description: 'Roles' } } },
    },
    '/roles/{role}/permissions': {
      put: { tags: ['Roles'], summary: 'Replace role permissions (Super Admin only)', parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' }, '403': { description: 'Forbidden' } } },
    },
    '/products': {
      get: { tags: ['Products'], summary: 'Public active product catalog with availability', security: [], responses: { '200': { description: 'Paginated products' } } },
      post: { tags: ['Products'], summary: 'Create a product (products.write)', responses: { '201': { description: 'Created' } } },
    },
    '/products/manage/list': {
      get: { tags: ['Products'], summary: 'Manager product list including costs and inactive items', responses: { '200': { description: 'Paginated products' } } },
    },
    '/products/{id}': {
      get: { tags: ['Products'], summary: 'Public product detail', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Product' } } },
      patch: { tags: ['Products'], summary: 'Update a product', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
    },
    '/products/{id}/archive': {
      post: { tags: ['Products'], summary: 'Archive a product (products.archive)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Archived' } } },
    },
    '/products/{id}/images': {
      post: { tags: ['Products'], summary: 'Upload a product image (multipart field: image)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'Uploaded' } } },
    },
    '/categories': {
      get: { tags: ['Categories'], summary: 'Public active categories', security: [], responses: { '200': { description: 'Categories' } } },
      post: { tags: ['Categories'], summary: 'Create a category (categories.write)', responses: { '201': { description: 'Created' } } },
    },
    '/warehouses': {
      get: { tags: ['Warehouses'], summary: 'Warehouses visible to the caller', responses: { '200': { description: 'Warehouses' } } },
      post: { tags: ['Warehouses'], summary: 'Create a warehouse (warehouses.write)', responses: { '201': { description: 'Created' } } },
    },
    '/inventory/balances': {
      get: { tags: ['Inventory'], summary: 'On-hand, reserved, available, average cost by warehouse', responses: { '200': { description: 'Paginated balances' } } },
    },
    '/inventory/movements': {
      get: { tags: ['Inventory'], summary: 'Immutable stock movement ledger', responses: { '200': { description: 'Paginated movements' } } },
    },
    '/inventory/adjustments': {
      get: { tags: ['Inventory'], summary: 'Adjustment requests visible to the caller', responses: { '200': { description: 'Adjustments' } } },
      post: { tags: ['Inventory'], summary: 'Request (or immediately apply) a stock adjustment', responses: { '201': { description: 'Adjustment' } } },
    },
    '/inventory/adjustments/{id}/approve': {
      post: { tags: ['Inventory'], summary: 'Approve and apply an adjustment (inventory.adjust)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Applied' } } },
    },
    '/inventory/transfers': {
      get: { tags: ['Inventory'], summary: 'Warehouse transfers', responses: { '200': { description: 'Transfers' } } },
      post: { tags: ['Inventory'], summary: 'Request a warehouse transfer', responses: { '201': { description: 'Transfer' } } },
    },
    '/inventory/transfers/{id}/complete': {
      post: { tags: ['Inventory'], summary: 'Complete a transfer atomically (inventory.adjust)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Completed' } } },
    },
    '/suppliers': {
      get: { tags: ['Suppliers'], summary: 'Supplier list (costs require suppliers.costs.read)', responses: { '200': { description: 'Suppliers' } } },
      post: { tags: ['Suppliers'], summary: 'Create a supplier (suppliers.write)', responses: { '201': { description: 'Created' } } },
    },
    '/purchase-orders': {
      get: { tags: ['Purchase Orders'], summary: 'List purchase orders', responses: { '200': { description: 'Paginated purchase orders' } } },
      post: { tags: ['Purchase Orders'], summary: 'Create a draft purchase order', responses: { '201': { description: 'Created' } } },
    },
    '/purchase-orders/{id}/submit': {
      post: { tags: ['Purchase Orders'], summary: 'Submit a draft for approval', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Submitted' } } },
    },
    '/purchase-orders/{id}/approve': {
      post: { tags: ['Purchase Orders'], summary: 'Approve a submitted purchase order (limit enforced)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Approved' }, '403': { description: 'Above approval limit' } } },
    },
    '/goods-receipts': {
      get: { tags: ['Goods Receipts'], summary: 'List goods receipts', responses: { '200': { description: 'Receipts' } } },
      post: { tags: ['Goods Receipts'], summary: 'Record a goods receipt and increase On-hand', responses: { '201': { description: 'Received' } } },
    },
    '/orders': {
      get: { tags: ['Orders'], summary: 'List customer orders within the caller scope', responses: { '200': { description: 'Paginated orders' } } },
      post: { tags: ['Orders'], summary: 'Place a customer order (PENDING, no reservation)', responses: { '201': { description: 'Created' } } },
    },
    '/orders/{id}': {
      get: { tags: ['Orders'], summary: 'Order detail with ownership/warehouse checks', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Order' }, '403': { description: 'Out of scope' } } },
    },
    '/orders/{id}/confirm': {
      post: { tags: ['Orders'], summary: 'Confirm an order and reserve stock atomically', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Confirmed' }, '409': { description: 'Insufficient stock or already processed' } } },
    },
    '/orders/{id}/cancel': {
      post: { tags: ['Orders'], summary: 'Cancel and release reservations', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Cancelled' } } },
    },
    '/orders/{id}/transition': {
      post: { tags: ['Orders'], summary: 'Advance fulfillment state through the validated state machine', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' }, '409': { description: 'Invalid transition' } } },
    },
    '/orders/{id}/payment': {
      post: { tags: ['Orders'], summary: 'Record an externally verified payment (orders.mark_paid)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Payment recorded' } } },
    },
    '/returns': {
      get: { tags: ['Returns'], summary: 'Returns visible to the caller', responses: { '200': { description: 'Returns' } } },
      post: { tags: ['Returns'], summary: 'Request a return against a delivered order', responses: { '201': { description: 'Created' } } },
    },
    '/reports/summary': {
      get: { tags: ['Reports'], summary: 'Role-aware dashboard summary', responses: { '200': { description: 'Summary' } } },
    },
    '/reports/inventory-valuation': {
      get: { tags: ['Reports'], summary: 'Inventory valuation at moving-average cost (financial permission)', responses: { '200': { description: 'Valuation' } } },
    },
    '/reports/sales': {
      get: { tags: ['Reports'], summary: 'Sales and top products; CSV with format=csv', responses: { '200': { description: 'Sales report' } } },
    },
    '/reports/stock-movements': {
      get: { tags: ['Reports'], summary: 'Stock movement history; CSV with format=csv', responses: { '200': { description: 'Movements' } } },
    },
    '/notifications': {
      get: { tags: ['Notifications'], summary: 'Current user notifications', responses: { '200': { description: 'Notifications' } } },
    },
    '/audit-logs': {
      get: { tags: ['Audit Logs'], summary: 'Audit log (audit.read)', responses: { '200': { description: 'Paginated audit logs' } } },
    },
    '/settings': {
      get: { tags: ['Settings'], summary: 'System settings (settings.read)', responses: { '200': { description: 'Settings' } } },
      put: { tags: ['Settings'], summary: 'Update system settings (settings.manage, Super Admin only)', responses: { '200': { description: 'Updated' } } },
    },
  },
};
