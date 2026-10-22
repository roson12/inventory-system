import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { AlertTriangle, Boxes, ClipboardList, Package, ShoppingBag, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money, qty } from '@/lib/utils';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton, Table, Td, Th } from '@/components/ui';
import type { Summary } from '@/types';

function StatCard({ label, value, icon: Icon, hint }: { label: string; value: string; icon: ComponentType<{ className?: string }>; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className="rounded-md bg-slate-100 p-2 text-slate-600">
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { me } = useAuth();
  const query = useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/reports/summary') });

  if (query.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
    );
  }
  if (query.error) return <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} />;

  const summary = query.data!;
  const greeting =
    me?.role === 'CUSTOMER'
      ? 'Browse products and track your orders.'
      : me?.role === 'STAFF'
        ? 'Your warehouse tasks and order queue.'
        : me?.role === 'ADMIN'
          ? 'Operations at a glance.'
          : 'System-wide inventory and business overview.';

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{greeting}</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {me?.role === 'CUSTOMER' ? (
          <>
            <StatCard label="Open orders" value={String(summary.pendingOrders)} icon={ShoppingBag} hint="Pending through dispatch" />
            <StatCard label="Available products" value={String(summary.activeProducts)} icon={Package} />
            <Link to="/catalog" className="contents">
              <StatCard label="Browse catalog" value="Shop now" icon={Boxes} hint="Search by name, SKU, or barcode" />
            </Link>
            <Link to="/orders" className="contents">
              <StatCard label="Order history" value="View orders" icon={ClipboardList} />
            </Link>
          </>
        ) : (
          <>
            <StatCard label="Active products" value={String(summary.activeProducts)} icon={Package} />
            <StatCard label="Warehouses" value={String(summary.activeWarehouses)} icon={Boxes} />
            <StatCard label="Orders in progress" value={String(summary.pendingOrders)} icon={ShoppingBag} />
            <StatCard label="Low-stock balances" value={String(summary.lowStockCount)} icon={AlertTriangle} />
            {summary.inventoryValue !== undefined ? (
              <StatCard label="Inventory value" value={money(summary.inventoryValue)} icon={Boxes} hint="Moving weighted average" />
            ) : null}
            {summary.salesLast30Days !== undefined ? (
              <StatCard label="Sales (30 days)" value={money(summary.salesLast30Days)} icon={TrendingUp} hint={`${summary.ordersLast30Days} orders`} />
            ) : null}
            <StatCard label="Pending approvals" value={String(summary.pendingPurchaseOrders)} icon={ClipboardList} hint="Purchase orders awaiting approval" />
          </>
        )}
      </div>

      {(me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN' || me?.role === 'STAFF') && summary.lowStock.length > 0 ? (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Low-stock alerts</CardTitle>
            <Link to="/inventory" className="text-sm text-slate-600 hover:underline">
              View inventory
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">On-hand</Th>
                  <Th className="text-right">Reorder level</Th>
                </tr>
              </thead>
              <tbody>
                {summary.lowStock.map((row) => (
                  <tr key={`${row.productId}-${row.warehouseId}`}>
                    <Td>{row.name}</Td>
                    <Td className="font-mono text-xs">{row.sku}</Td>
                    <Td className="text-right">{qty(row.onHand)}</Td>
                    <Td className="text-right">{qty(row.reorderLevel)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{me?.role === 'CUSTOMER' ? 'Your recent orders' : 'Recent orders'}</CardTitle>
          <Link to="/orders" className="text-sm text-slate-600 hover:underline">
            All orders
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {summary.recentOrders.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No orders yet" description="Orders will appear here as soon as they are placed." />
            </div>
          ) : (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Placed</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {summary.recentOrders.map((order) => (
                  <tr key={order.id}>
                    <Td>
                      <Link to={`/orders/${order.id}`} className="font-medium hover:underline">
                        {order.orderNumber}
                      </Link>
                    </Td>
                    <Td>{order.customer.name}</Td>
                    <Td>
                      <Badge status={order.status} />
                    </Td>
                    <Td>{formatDate(order.placedAt)}</Td>
                    <Td className="text-right">{money(order.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
