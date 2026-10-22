import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Skeleton } from '@/components/ui';
import { Link } from 'react-router-dom';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from '@/pages/auth/AuthPages';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { CatalogPage, ProductDetailPage } from '@/pages/customer/CatalogPages';
import { CartPage, CheckoutPage } from '@/pages/customer/CartPages';
import { OrderDetailPage, OrdersPage } from '@/pages/orders/OrdersPages';
import { ReturnsPage } from '@/pages/returns/ReturnsPage';
import { NotificationsPage, ProfilePage } from '@/pages/admin/ProfilePages';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { CategoriesPage } from '@/pages/categories/CategoriesPage';
import {
  AdjustmentsPage,
  InventoryPage,
  MovementsPage,
  TransfersPage,
  WarehousesPage,
} from '@/pages/inventory/InventoryPages';
import { SuppliersPage } from '@/pages/suppliers/SuppliersPage';
import {
  GoodsReceiptsPage,
  PurchaseOrderDetailPage,
  PurchaseOrdersPage,
} from '@/pages/purchase-orders/PurchaseOrderPages';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { AuditLogsPage, RolesPage, SettingsPage } from '@/pages/admin/AdminPages';
import { UsersPage } from '@/pages/admin/UsersPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { me, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequirePermission({ any, children }: { any: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!any.some((permission) => can(permission))) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h2 className="text-2xl font-semibold">403 — Not permitted</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Your role does not have access to this area. This page is protected by the API as well, so
        changing the URL cannot grant access.
      </p>
      <Link to="/"><Button>Back to dashboard</Button></Link>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h2 className="text-2xl font-semibold">Page not found</h2>
      <Link to="/"><Button>Back to dashboard</Button></Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:id" element={<ProductDetailPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route
          path="/inventory"
          element={<RequirePermission any={['inventory.read']}><InventoryPage /></RequirePermission>}
        />
        <Route
          path="/movements"
          element={<RequirePermission any={['inventory.read']}><MovementsPage /></RequirePermission>}
        />
        <Route
          path="/adjustments"
          element={<RequirePermission any={['inventory.read']}><AdjustmentsPage /></RequirePermission>}
        />
        <Route
          path="/transfers"
          element={<RequirePermission any={['inventory.read']}><TransfersPage /></RequirePermission>}
        />
        <Route
          path="/warehouses"
          element={<RequirePermission any={['warehouses.read']}><WarehousesPage /></RequirePermission>}
        />
        <Route
          path="/products"
          element={<RequirePermission any={['products.write', 'products.archive']}><ProductsPage /></RequirePermission>}
        />
        <Route
          path="/categories"
          element={<RequirePermission any={['categories.write']}><CategoriesPage /></RequirePermission>}
        />
        <Route
          path="/suppliers"
          element={<RequirePermission any={['suppliers.read']}><SuppliersPage /></RequirePermission>}
        />
        <Route
          path="/purchase-orders"
          element={<RequirePermission any={['purchase_orders.read']}><PurchaseOrdersPage /></RequirePermission>}
        />
        <Route
          path="/purchase-orders/:id"
          element={<RequirePermission any={['purchase_orders.read']}><PurchaseOrderDetailPage /></RequirePermission>}
        />
        <Route
          path="/goods-receipts"
          element={<RequirePermission any={['goods_receipts.create', 'purchase_orders.read']}><GoodsReceiptsPage /></RequirePermission>}
        />
        <Route
          path="/reports"
          element={<RequirePermission any={['reports.view', 'reports.financial']}><ReportsPage /></RequirePermission>}
        />
        <Route
          path="/users"
          element={<RequirePermission any={['users.read']}><UsersPage /></RequirePermission>}
        />
        <Route
          path="/roles"
          element={<RequirePermission any={['users.read', 'roles.manage']}><RolesPage /></RequirePermission>}
        />
        <Route
          path="/audit-logs"
          element={<RequirePermission any={['audit.read']}><AuditLogsPage /></RequirePermission>}
        />
        <Route
          path="/settings"
          element={<RequirePermission any={['settings.read', 'settings.manage']}><SettingsPage /></RequirePermission>}
        />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
