import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money, qty } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';
import type { CustomerOrder } from '@/types';

const statuses = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_DISPATCH',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
];

export function OrdersPage() {
  const { me, can } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const orders = useQuery({
    queryKey: ['orders', status, q, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      return apiPage<CustomerOrder>(`/orders?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input placeholder="Search order number or customer" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} className="sm:max-w-sm" />
        <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="sm:max-w-xs">
          <option value="">All statuses</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </div>

      {orders.isLoading ? (
        <Skeleton className="h-64" />
      ) : orders.error ? (
        <ErrorState message={(orders.error as Error).message} retry={() => void orders.refetch()} />
      ) : orders.data!.data.length === 0 ? (
        <EmptyState
          title="No orders"
          description={me?.role === 'CUSTOMER' ? 'Place an order from the catalog.' : 'Orders matching these filters will appear here.'}
          action={me?.role === 'CUSTOMER' ? <Link to="/catalog"><Button>Browse catalog</Button></Link> : undefined}
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Payment</Th>
                <Th>Placed</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {orders.data!.data.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <Td>
                    <Link to={`/orders/${order.id}`} className="font-medium hover:underline">
                      {order.orderNumber}
                    </Link>
                    {order.warehouse ? <p className="text-xs text-slate-500">{order.warehouse.name}</p> : null}
                  </Td>
                  <Td>
                    {order.customer.name}
                    <p className="text-xs text-slate-500">{order.customer.email}</p>
                  </Td>
                  <Td><Badge status={order.status} /></Td>
                  <Td><Badge status={order.paymentStatus} /></Td>
                  <Td>{formatDate(order.placedAt)}</Td>
                  <Td className="text-right">{money(order.total, order.currencyCode)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={orders.data!.meta.page} totalPages={orders.data!.meta.totalPages} onPage={setPage} />
        </>
      )}
      {can('orders.confirm') ? (
        <p className="text-xs text-muted-foreground">
          Confirming an order reserves stock atomically. Open an order to confirm or advance it.
        </p>
      ) : null}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<CustomerOrder>(`/orders/${id}`),
    enabled: Boolean(id),
  });

  async function action(path: string, body?: unknown, label = 'Update') {
    setBusy(path);
    try {
      await api(path, { method: 'POST', body });
      toast.success(`${label} succeeded`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order', id] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['summary'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy('');
    }
  }

  if (order.isLoading) return <Skeleton className="h-80" />;
  if (order.error) return <ErrorState message={(order.error as Error).message} retry={() => void order.refetch()} />;
  const data = order.data!;

  const nextStatus =
    data.status === 'CONFIRMED'
      ? 'PROCESSING'
      : data.status === 'PROCESSING'
        ? 'READY_FOR_DISPATCH'
        : data.status === 'READY_FOR_DISPATCH'
          ? 'SHIPPED'
          : data.status === 'SHIPPED'
            ? 'DELIVERED'
            : null;

  return (
    <div className="space-y-4">
      <Link to="/orders" className="text-sm text-slate-600 hover:underline">
        ← Back to orders
      </Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{data.orderNumber}</CardTitle>
              <p className="text-xs text-muted-foreground">Placed {formatDate(data.placedAt, true)}</p>
            </div>
            <div className="flex gap-2">
              <Badge status={data.status} />
              <Badge status={data.paymentStatus} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th className="text-right">Unit price</Th>
                  <Th className="text-right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <Td>
                      <p className="font-medium">{item.productName}</p>
                      <p className="font-mono text-xs text-slate-500">{item.sku}</p>
                    </Td>
                    <Td className="text-right">{qty(item.quantity)}</Td>
                    <Td className="text-right">{money(item.unitPrice, data.currencyCode)}</Td>
                    <Td className="text-right">{money(item.lineTotal, data.currencyCode)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="space-y-1 border-t p-5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{money(data.subtotal, data.currencyCode)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{money(data.taxTotal, data.currencyCode)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{money(data.total, data.currencyCode)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Fulfillment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Warehouse:</span> {data.warehouse?.name ?? 'Chosen at confirmation'}</p>
              <p><span className="text-muted-foreground">Ship to:</span> {data.shippingName}</p>
              <p className="whitespace-pre-line text-slate-700">{data.shippingAddress}</p>
              {data.shippingPhone ? <p>{data.shippingPhone}</p> : null}
              {data.notes ? <p className="rounded bg-slate-50 p-2 text-xs">{data.notes}</p> : null}
              {data.cancelReason ? <p className="text-xs text-red-700">Cancelled: {data.cancelReason}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {can('orders.confirm') && data.status === 'PENDING' ? (
                <Button size="sm" disabled={busy !== ''} onClick={() => void action(`/orders/${data.id}/confirm`, undefined, 'Confirmation')}>
                  Confirm & reserve stock
                </Button>
              ) : null}
              {can('orders.process') && nextStatus ? (
                <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void action(`/orders/${data.id}/transition`, { status: nextStatus }, nextStatus.replaceAll('_', ' ').toLowerCase())}>
                  Mark {nextStatus.replaceAll('_', ' ').toLowerCase()}
                </Button>
              ) : null}
              {can('orders.mark_paid') && data.paymentStatus !== 'PAID' && data.status !== 'CANCELLED' ? (
                <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void action(`/orders/${data.id}/payment`, { paymentMethod: 'manual', paymentReference: `Recorded by ${me?.name}` }, 'Payment')}>
                  Record payment
                </Button>
              ) : null}
              {((me?.role === 'CUSTOMER' && data.status === 'PENDING') ||
                (me?.role !== 'CUSTOMER' && can('orders.cancel') && !['SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'].includes(data.status))) ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== ''}
                  onClick={() => {
                    const reason = window.prompt('Reason for cancellation (optional)') ?? undefined;
                    void action(`/orders/${data.id}/cancel`, { reason }, 'Cancellation');
                  }}
                >
                  Cancel order
                </Button>
              ) : null}
              {me?.role === 'CUSTOMER' && data.status === 'DELIVERED' ? (
                <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
                  Request return
                </Button>
              ) : null}
              {data.status === 'PENDING' && me?.role === 'CUSTOMER' ? (
                <p className="w-full text-xs text-muted-foreground">You can cancel while the order is pending.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Request a return"
        description="Quantities are limited to what was delivered."
        footer={
          <>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button
              disabled={busy !== '' || returnReason.trim().length < 3}
              onClick={async () => {
                const items = Object.entries(returnItems)
                  .filter(([, quantity]) => quantity > 0)
                  .map(([orderItemId, quantity]) => ({ orderItemId, quantity, restock: true }));
                if (items.length === 0) {
                  toast.error('Select at least one item');
                  return;
                }
                setBusy('return');
                try {
                  await api('/returns', {
                    method: 'POST',
                    body: { orderId: data.id, reason: returnReason, items },
                  });
                  toast.success('Return requested');
                  setReturnOpen(false);
                  setReturnItems({});
                  setReturnReason('');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Return request failed');
                } finally {
                  setBusy('');
                }
              }}
            >
              Submit request
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Reason">
            <Textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
          </Field>
          {data.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{item.productName}</p>
                <p className="text-xs text-muted-foreground">Delivered {qty(item.quantity)}</p>
              </div>
              <Input
                type="number"
                min={0}
                max={Number(item.quantity)}
                value={returnItems[item.id] ?? 0}
                onChange={(event) => setReturnItems({ ...returnItems, [item.id]: Number(event.target.value) })}
                className="w-24"
                aria-label={`Return quantity for ${item.productName}`}
              />
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
