import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
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
import type { GoodsReceipt, Product, PurchaseOrder, Supplier, Warehouse } from '@/types';

export function PurchaseOrdersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: '1', unitCost: '0' }]);

  const orders = useQuery({
    queryKey: ['purchase-orders', page],
    queryFn: () => apiPage<PurchaseOrder>(`/purchase-orders?page=${page}&pageSize=20`),
  });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
  const products = useQuery({ queryKey: ['manage-products-select'], queryFn: () => apiPage<Product>('/products/manage/list?pageSize=100') });

  async function create() {
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: {
          supplierId,
          warehouseId,
          notes: notes || undefined,
          items: lines.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            unitCost: Number(line.unitCost),
          })),
        },
      });
      toast.success('Draft purchase order created');
      setOpen(false);
      setLines([{ productId: '', quantity: '1', unitCost: '0' }]);
      setNotes('');
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create purchase order');
    }
  }

  return (
    <div className="space-y-4">
      {can('purchase_orders.write') ? (
        <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New purchase order</Button></div>
      ) : null}
      {orders.isLoading ? (
        <Skeleton className="h-64" />
      ) : orders.error ? (
        <ErrorState message={(orders.error as Error).message} />
      ) : orders.data!.data.length === 0 ? (
        <EmptyState title="No purchase orders" />
      ) : (
        <>
          <Table>
            <thead>
              <tr><Th>PO</Th><Th>Supplier</Th><Th>Warehouse</Th><Th>Status</Th><Th>Created</Th><Th className="text-right">Total</Th><Th /></tr>
            </thead>
            <tbody>
              {orders.data!.data.map((order) => (
                <tr key={order.id}>
                  <Td><Link to={`/purchase-orders/${order.id}`} className="font-medium hover:underline">{order.poNumber}</Link></Td>
                  <Td>{order.supplier.name}</Td>
                  <Td>{order.warehouse.name}</Td>
                  <Td><Badge status={order.status} /></Td>
                  <Td>{formatDate(order.createdAt)}</Td>
                  <Td className="text-right">{money(order.total)}</Td>
                  <Td>{order.approvalRequired ? <Badge className="bg-amber-100 text-amber-800">Approval needed</Badge> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={orders.data!.meta.page} totalPages={orders.data!.meta.totalPages} onPage={setPage} />
        </>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New purchase order"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void create()}
              disabled={!supplierId || !warehouseId || lines.some((line) => !line.productId)}
            >
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier">
              <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">Select supplier</option>
                {(suppliers.data ?? []).map((supplier) => (<option key={supplier.id} value={supplier.id}>{supplier.name}</option>))}
              </Select>
            </Field>
            <Field label="Receive into warehouse">
              <Select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                <option value="">Select warehouse</option>
                {(warehouses.data ?? []).map((warehouse) => (<option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>))}
              </Select>
            </Field>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_120px_120px_40px]">
              <Field label={`Product ${index + 1}`}>
                <Select value={line.productId} onChange={(event) => setLines(lines.map((row, i) => (i === index ? { ...row, productId: event.target.value } : row)))}>
                  <option value="">Select product</option>
                  {(products.data?.data ?? []).map((product) => (<option key={product.id} value={product.id}>{product.sku} — {product.name}</option>))}
                </Select>
              </Field>
              <Field label="Quantity">
                <Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLines(lines.map((row, i) => (i === index ? { ...row, quantity: event.target.value } : row)))} />
              </Field>
              <Field label="Unit cost">
                <Input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setLines(lines.map((row, i) => (i === index ? { ...row, unitCost: event.target.value } : row)))} />
              </Field>
              <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { productId: '', quantity: '1', unitCost: '0' }])}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
          <Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState('');
  const [receipt, setReceipt] = useState<Record<string, string>>({});

  const order = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`),
    enabled: Boolean(id),
  });

  async function act(path: string, label: string) {
    setBusy(path);
    try {
      await api(path, { method: 'POST' });
      toast.success(label);
      await queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy('');
    }
  }

  async function receive() {
    if (!order.data) return;
    const items = Object.entries(receipt)
      .map(([purchaseOrderItemId, quantity]) => ({ purchaseOrderItemId, quantity: Number(quantity) }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) {
      toast.error('Enter quantities to receive');
      return;
    }
    setBusy('receive');
    try {
      await api('/goods-receipts', {
        method: 'POST',
        body: { purchaseOrderId: order.data.id, items },
      });
      toast.success('Goods receipt confirmed');
      setReceipt({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchase-order', id] }),
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['goods-receipts'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Receipt failed');
    } finally {
      setBusy('');
    }
  }

  if (order.isLoading) return <Skeleton className="h-80" />;
  if (order.error) return <ErrorState message={(order.error as Error).message} />;
  const data = order.data!;
  const canReceive = can('goods_receipts.create') && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(data.status);

  return (
    <div className="space-y-4">
      <Link to="/purchase-orders" className="text-sm text-slate-600 hover:underline">← Back to purchase orders</Link>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{data.poNumber}</CardTitle>
            <p className="text-xs text-muted-foreground">{data.supplier.name} → {data.warehouse.name}</p>
          </div>
          <div className="flex gap-2"><Badge status={data.status} />{data.approvalRequired ? <Badge className="bg-amber-100 text-amber-800">Above approval limit</Badge> : null}</div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="rounded-none border-0">
            <thead>
              <tr><Th>Product</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Line total</Th>{canReceive ? <Th>Receive now</Th> : null}</tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const outstanding = Math.max(0, Number(item.quantity) - Number(item.receivedQty));
                return (
                  <tr key={item.id}>
                    <Td><p className="font-medium">{item.product.name}</p><p className="font-mono text-xs text-slate-500">{item.product.sku}</p></Td>
                    <Td className="text-right">{qty(item.quantity)}</Td>
                    <Td className="text-right">{qty(item.receivedQty)}</Td>
                    <Td className="text-right">{money(item.unitCost)}</Td>
                    <Td className="text-right">{money(item.lineTotal)}</Td>
                    {canReceive ? (
                      <Td>
                        <Input
                          type="number"
                          min="0"
                          max={outstanding}
                          step="0.001"
                          value={receipt[item.id] ?? ''}
                          placeholder={String(outstanding)}
                          onChange={(event) => setReceipt({ ...receipt, [item.id]: event.target.value })}
                          className="w-28"
                          aria-label={`Receive quantity for ${item.product.name}`}
                        />
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-5">
            <div className="text-sm">
              <p>Subtotal: {money(data.subtotal)}</p>
              <p>Tax: {money(data.taxTotal)}</p>
              <p className="font-semibold">Total: {money(data.total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can('purchase_orders.write') && data.status === 'DRAFT' ? (
                <Button size="sm" disabled={busy !== ''} onClick={() => void act(`/purchase-orders/${data.id}/submit`, 'Submitted for approval')}>Submit</Button>
              ) : null}
              {can('purchase_orders.approve') && data.status === 'SUBMITTED' ? (
                <>
                  <Button size="sm" disabled={busy !== ''} onClick={() => void act(`/purchase-orders/${data.id}/approve`, 'Approved')}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy !== ''} onClick={() => void act(`/purchase-orders/${data.id}/reject`, 'Rejected')}>Reject</Button>
                </>
              ) : null}
              {canReceive ? (
                <Button size="sm" disabled={busy !== ''} onClick={() => void receive()}>Confirm receipt</Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {data.receipts?.length ? (
        <Card>
          <CardHeader><CardTitle>Goods receipts</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table className="rounded-none border-0">
              <thead><tr><Th>Receipt</Th><Th>Received</Th><Th>Items</Th></tr></thead>
              <tbody>
                {data.receipts.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-mono text-xs">{row.receiptNumber}</Td>
                    <Td>{formatDate(row.receivedAt, true)}</Td>
                    <Td>{row.items.map((item) => (<p key={item.id} className="text-xs">{item.productId} × {qty(item.quantity)}</p>))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function GoodsReceiptsPage() {
  const receipts = useQuery({ queryKey: ['goods-receipts'], queryFn: () => api<GoodsReceipt[]>('/goods-receipts') });

  if (receipts.isLoading) return <Skeleton className="h-64" />;
  if (receipts.error) return <ErrorState message={(receipts.error as Error).message} />;
  if (receipts.data!.length === 0) return <EmptyState title="No goods receipts" description="Receive against an approved purchase order." />;

  return (
    <Table>
      <thead><tr><Th>Receipt</Th><Th>Purchase order</Th><Th>Warehouse</Th><Th>Received</Th><Th>By</Th><Th>Items</Th></tr></thead>
      <tbody>
        {receipts.data!.map((receipt) => (
          <tr key={receipt.id}>
            <Td className="font-mono text-xs">{receipt.receiptNumber}</Td>
            <Td>{receipt.purchaseOrder ? <Link to={`/purchase-orders/${receipt.purchaseOrder.id}`} className="hover:underline">{receipt.purchaseOrder.poNumber}</Link> : '—'}</Td>
            <Td>{receipt.warehouse?.name ?? '—'}</Td>
            <Td>{formatDate(receipt.receivedAt, true)}</Td>
            <Td>{receipt.receivedBy?.name ?? '—'}</Td>
            <Td>{receipt.items.map((item) => (<p key={item.id} className="text-xs">{item.product.sku} × {qty(item.quantity)} @ {money(item.unitCost)}</p>))}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
