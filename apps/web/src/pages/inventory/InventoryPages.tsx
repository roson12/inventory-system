import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money, qty } from '@/lib/utils';
import {
  Badge,
  Button,
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
import type { Adjustment, InventoryBalance, Product, StockMovement, Transfer, Warehouse } from '@/types';

function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
}
function useProductsForSelect() {
  return useQuery({
    queryKey: ['manage-products-select'],
    queryFn: () => apiPage<Product>('/products/manage/list?pageSize=100'),
  });
}

export function InventoryPage() {
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const warehouses = useWarehouses();
  const balances = useQuery({
    queryKey: ['inventory', search, warehouseId, lowStock, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', sortBy: 'updatedAt', sortDir: 'desc' });
      if (search) params.set('search', search);
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (lowStock) params.set('lowStock', 'true');
      return apiPage<InventoryBalance>(`/inventory/balances?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row">
        <Input placeholder="Search product or SKU" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="lg:max-w-sm" />
        <Select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }} className="lg:max-w-xs">
          <option value="">All warehouses</option>
          {(warehouses.data ?? []).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowStock} onChange={(event) => { setLowStock(event.target.checked); setPage(1); }} />
          Low stock only
        </label>
      </div>

      {balances.isLoading ? (
        <Skeleton className="h-64" />
      ) : balances.error ? (
        <ErrorState message={(balances.error as Error).message} retry={() => void balances.refetch()} />
      ) : balances.data!.data.length === 0 ? (
        <EmptyState title="No inventory balances" description="Stock appears after opening stock, receipts, or adjustments." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Warehouse</Th>
                <Th className="text-right">On-hand</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Avg cost</Th>
                <Th className="text-right">Value</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {balances.data!.data.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <p className="font-medium">{row.product.name}</p>
                    <p className="font-mono text-xs text-slate-500">{row.product.sku}</p>
                  </Td>
                  <Td>{row.warehouse.name}</Td>
                  <Td className="text-right">{qty(row.onHand)}</Td>
                  <Td className="text-right">{qty(row.reserved)}</Td>
                  <Td className="text-right font-medium">{qty(row.available)}</Td>
                  <Td className="text-right">{money(row.avgCost)}</Td>
                  <Td className="text-right">{money(row.value)}</Td>
                  <Td>{row.isLowStock ? <Badge status="LOW">Low</Badge> : <Badge status="ACTIVE">OK</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={balances.data!.meta.page} totalPages={balances.data!.meta.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function MovementsPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const warehouses = useWarehouses();
  const movements = useQuery({
    queryKey: ['movements', warehouseId, type, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (type) params.set('type', type);
      return apiPage<StockMovement>(`/inventory/movements?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }} className="sm:max-w-xs">
          <option value="">All warehouses</option>
          {(warehouses.data ?? []).map((warehouse) => (<option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>))}
        </Select>
        <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="sm:max-w-xs">
          <option value="">All movement types</option>
          {['OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT'].map((value) => (
            <option key={value} value={value}>{value.replaceAll('_', ' ').toLowerCase()}</option>
          ))}
        </Select>
      </div>
      {movements.isLoading ? (
        <Skeleton className="h-64" />
      ) : movements.error ? (
        <ErrorState message={(movements.error as Error).message} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Product</Th>
                <Th>Warehouse</Th>
                <Th className="text-right">Quantity</Th>
                <Th className="text-right">Unit cost</Th>
                <Th className="text-right">Balance after</Th>
                <Th>Reference</Th>
              </tr>
            </thead>
            <tbody>
              {movements.data!.data.map((movement) => (
                <tr key={movement.id}>
                  <Td className="whitespace-nowrap">{formatDate(movement.createdAt, true)}</Td>
                  <Td><Badge status={movement.type} /></Td>
                  <Td>
                    <p className="font-medium">{movement.product.name}</p>
                    <p className="font-mono text-xs text-slate-500">{movement.product.sku}</p>
                  </Td>
                  <Td>{movement.warehouse.name}</Td>
                  <Td className={Number(movement.quantity) < 0 ? 'text-right text-red-700' : 'text-right text-emerald-700'}>
                    {Number(movement.quantity) > 0 ? '+' : ''}{qty(movement.quantity)}
                  </Td>
                  <Td className="text-right">{money(movement.unitCost)}</Td>
                  <Td className="text-right">{qty(movement.balanceAfter)}</Td>
                  <Td className="text-xs text-slate-500">{movement.referenceType ?? movement.reason ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={movements.data!.meta.page} totalPages={movements.data!.meta.totalPages} onPage={setPage} />
        </>
      )}
      <p className="text-xs text-muted-foreground">The ledger is append-only; there is no endpoint to edit or delete a movement.</p>
    </div>
  );
}

export function AdjustmentsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: '', warehouseId: '', kind: 'INCREASE', quantity: '1', unitCost: '', reason: '' });
  const warehouses = useWarehouses();
  const products = useProductsForSelect();
  const adjustments = useQuery({ queryKey: ['adjustments'], queryFn: () => api<Adjustment[]>('/inventory/adjustments') });

  async function create() {
    try {
      await api('/inventory/adjustments', {
        method: 'POST',
        body: {
          productId: form.productId,
          warehouseId: form.warehouseId,
          kind: form.kind,
          quantity: Number(form.quantity),
          unitCost: form.unitCost ? Number(form.unitCost) : undefined,
          reason: form.reason,
        },
      });
      toast.success('Adjustment submitted');
      setOpen(false);
      setForm({ productId: '', warehouseId: '', kind: 'INCREASE', quantity: '1', unitCost: '', reason: '' });
      await queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Adjustment failed');
    }
  }

  async function act(id: string, action: 'approve' | 'reject') {
    try {
      await api(`/inventory/adjustments/${id}/${action}`, { method: 'POST' });
      toast.success(`Adjustment ${action}d`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['adjustments'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New adjustment</Button>
      </div>
      {adjustments.isLoading ? (
        <Skeleton className="h-64" />
      ) : adjustments.error ? (
        <ErrorState message={(adjustments.error as Error).message} />
      ) : adjustments.data!.length === 0 ? (
        <EmptyState title="No adjustments" description="Adjustments always carry a reason and an actor." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th>Kind</Th>
              <Th className="text-right">Quantity</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Requested by</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {adjustments.data!.map((row) => (
              <tr key={row.id}>
                <Td className="font-mono text-xs">{row.adjustmentNumber}</Td>
                <Td>{row.product.name}<p className="font-mono text-xs text-slate-500">{row.product.sku}</p></Td>
                <Td>{row.warehouse.name}</Td>
                <Td>{row.kind}</Td>
                <Td className="text-right">{qty(row.quantity)}</Td>
                <Td className="max-w-48 truncate">{row.reason}</Td>
                <Td><Badge status={row.status} /></Td>
                <Td>{row.requestedBy?.name ?? '—'}</Td>
                <Td>
                  {can('inventory.adjust') && row.status === 'PENDING' ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => void act(row.id, 'approve')}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => void act(row.id, 'reject')}>Reject</Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Stock adjustment"
        description="Users with inventory.adjust apply immediately; others submit a request for approval."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void create()} disabled={!form.productId || !form.warehouseId || form.reason.length < 3}>Submit</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Product">
              <Select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
                <option value="">Select product</option>
                {(products.data?.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Warehouse">
            <Select value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
              <option value="">Select warehouse</option>
              {(warehouses.data ?? []).map((warehouse) => (<option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>))}
            </Select>
          </Field>
          <Field label="Kind">
            <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="INCREASE">Increase</option>
              <option value="DECREASE">Decrease</option>
              <option value="SET">Set to</option>
            </Select>
          </Field>
          <Field label="Quantity">
            <Input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </Field>
          <Field label="Unit cost (optional)">
            <Input type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason">
              <Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            </Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function TransfersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', notes: '' });
  const [items, setItems] = useState([{ productId: '', quantity: '1' }]);
  const warehouses = useWarehouses();
  const products = useProductsForSelect();
  const transfers = useQuery({ queryKey: ['transfers'], queryFn: () => api<Transfer[]>('/inventory/transfers') });

  async function create() {
    try {
      await api('/inventory/transfers', {
        method: 'POST',
        body: {
          fromWarehouseId: form.fromWarehouseId,
          toWarehouseId: form.toWarehouseId,
          notes: form.notes || undefined,
          items: items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
        },
      });
      toast.success('Transfer requested');
      setOpen(false);
      setItems([{ productId: '', quantity: '1' }]);
      await queryClient.invalidateQueries({ queryKey: ['transfers'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Transfer request failed');
    }
  }

  async function complete(id: string) {
    try {
      await api(`/inventory/transfers/${id}/complete`, { method: 'POST' });
      toast.success('Transfer completed');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['movements'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Completion failed');
    }
  }

  return (
    <div className="space-y-4">
      {can('inventory.transfer') ? (
        <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New transfer</Button></div>
      ) : null}
      {transfers.isLoading ? (
        <Skeleton className="h-64" />
      ) : transfers.error ? (
        <ErrorState message={(transfers.error as Error).message} />
      ) : transfers.data!.length === 0 ? (
        <EmptyState title="No transfers" description="Move stock between warehouses at the source carrying cost." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Items</Th>
              <Th>Status</Th>
              <Th>Requested</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {transfers.data!.map((transfer) => (
              <tr key={transfer.id}>
                <Td className="font-mono text-xs">{transfer.transferNumber}</Td>
                <Td>{transfer.fromWarehouse.name}</Td>
                <Td>{transfer.toWarehouse.name}</Td>
                <Td>
                  {transfer.items.map((item) => (<p key={item.id} className="text-xs">{item.product.sku} × {qty(item.quantity)}</p>))}
                </Td>
                <Td><Badge status={transfer.status} /></Td>
                <Td>{formatDate(transfer.createdAt)}</Td>
                <Td>
                  {can('inventory.adjust') && ['PENDING', 'APPROVED'].includes(transfer.status) ? (
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => void complete(transfer.id)}>Complete</Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Warehouse transfer"
        description="Stock moves at the source warehouse's moving-average cost."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => void create()}
              disabled={!form.fromWarehouseId || !form.toWarehouseId || form.fromWarehouseId === form.toWarehouseId || items.some((item) => !item.productId)}
            >
              Request transfer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From warehouse">
              <Select value={form.fromWarehouseId} onChange={(event) => setForm({ ...form, fromWarehouseId: event.target.value })}>
                <option value="">Select</option>
                {(warehouses.data ?? []).map((warehouse) => (<option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>))}
              </Select>
            </Field>
            <Field label="To warehouse">
              <Select value={form.toWarehouseId} onChange={(event) => setForm({ ...form, toWarehouseId: event.target.value })}>
                <option value="">Select</option>
                {(warehouses.data ?? []).map((warehouse) => (<option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>))}
              </Select>
            </Field>
          </div>
          {items.map((item, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={`Product ${index + 1}`}>
                  <Select
                    value={item.productId}
                    onChange={(event) => setItems(items.map((row, i) => (i === index ? { ...row, productId: event.target.value } : row)))}
                  >
                    <option value="">Select product</option>
                    {(products.data?.data ?? []).map((product) => (
                      <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-28">
                <Field label="Quantity">
                  <Input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={item.quantity}
                    onChange={(event) => setItems(items.map((row, i) => (i === index ? { ...row, quantity: event.target.value } : row)))}
                  />
                </Field>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mb-1"
                aria-label="Remove row"
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setItems([...items, { productId: '', quantity: '1' }])}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
          <Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

export function WarehousesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', address: '' });
  const warehouses = useWarehouses();

  async function save() {
    try {
      await api('/warehouses', { method: 'POST', body: { ...form, address: form.address || null } });
      toast.success('Warehouse created');
      setOpen(false);
      setForm({ code: '', name: '', address: '' });
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    }
  }

  if (warehouses.isLoading) return <Skeleton className="h-64" />;
  if (warehouses.error) return <ErrorState message={(warehouses.error as Error).message} />;

  return (
    <div className="space-y-4">
      {can('warehouses.write') ? (
        <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New warehouse</Button></div>
      ) : null}
      <Table>
        <thead>
          <tr><Th>Code</Th><Th>Name</Th><Th>Address</Th><Th>Status</Th></tr>
        </thead>
        <tbody>
          {warehouses.data!.map((warehouse) => (
            <tr key={warehouse.id}>
              <Td className="font-mono text-xs">{warehouse.code}</Td>
              <Td className="font-medium">{warehouse.name}</Td>
              <Td>{warehouse.address ?? '—'}</Td>
              <Td><Badge status={warehouse.isActive ? 'ACTIVE' : 'INACTIVE'} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New warehouse"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={!form.code || !form.name}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Code"><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></Field>
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Address"><Textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
