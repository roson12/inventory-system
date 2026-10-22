import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Skeleton, Table, Td, Th } from '@/components/ui';

interface SalesReport {
  from: string;
  to: string;
  orderCount: number;
  revenue: string;
  daily: { date: string; revenue: string; orders: number }[];
  topProducts: { productId: string; name: string; sku: string; quantity: string; revenue: string }[];
}
interface ValuationRow {
  warehouse: string;
  warehouseCode: string;
  sku: string;
  product: string;
  onHand: string;
  avgCost: string;
  value: string;
}

async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const sales = useQuery({
    queryKey: ['report-sales', from, to],
    queryFn: () => api<SalesReport>(`/reports/sales?from=${from}&to=${to}`),
  });
  const valuation = useQuery({
    queryKey: ['report-valuation'],
    queryFn: () => api<ValuationRow[] | { data: ValuationRow[]; meta: { totalValue: string } }>('/reports/inventory-valuation'),
    enabled: can('reports.financial'),
  });
  const valuationRows = Array.isArray(valuation.data) ? valuation.data : valuation.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="from">From</label>
          <Input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="to">To</label>
          <Input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <Button
          variant="outline"
          onClick={() => void downloadCsv(`/reports/sales?from=${from}&to=${to}&format=csv`, 'sales-report.csv')}
        >
          <Download className="h-4 w-4" /> Sales CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => void downloadCsv(`/reports/stock-movements?from=${from}&to=${to}&format=csv`, 'stock-movements.csv')}
        >
          <Download className="h-4 w-4" /> Movements CSV
        </Button>
      </div>

      {sales.isLoading ? (
        <Skeleton className="h-72" />
      ) : sales.error ? (
        <ErrorState message={(sales.error as Error).message} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent><p className="text-sm text-muted-foreground">Revenue</p><p className="mt-1 text-2xl font-semibold">{money(sales.data!.revenue)}</p><p className="text-xs text-muted-foreground">Not profit — cost data is reported separately.</p></CardContent></Card>
            <Card><CardContent><p className="text-sm text-muted-foreground">Orders</p><p className="mt-1 text-2xl font-semibold">{sales.data!.orderCount}</p></CardContent></Card>
            <Card><CardContent><p className="text-sm text-muted-foreground">Average order</p><p className="mt-1 text-2xl font-semibold">{money(sales.data!.orderCount ? Number(sales.data!.revenue) / sales.data!.orderCount : 0)}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Daily revenue</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sales.data!.daily}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Bar dataKey="revenue" fill="#1e293b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Top products</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table className="rounded-none border-0">
                <thead><tr><Th>Product</Th><Th>SKU</Th><Th className="text-right">Quantity</Th><Th className="text-right">Revenue</Th></tr></thead>
                <tbody>
                  {sales.data!.topProducts.map((product) => (
                    <tr key={product.productId}>
                      <Td>{product.name}</Td>
                      <Td className="font-mono text-xs">{product.sku}</Td>
                      <Td className="text-right">{product.quantity}</Td>
                      <Td className="text-right">{money(product.revenue)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {can('reports.financial') ? (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Inventory valuation</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void downloadCsv('/reports/inventory-valuation?format=csv', 'inventory-valuation.csv')}
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {valuation.isLoading ? (
              <div className="p-5"><Skeleton className="h-32" /></div>
            ) : (
              <Table className="rounded-none border-0">
                <thead><tr><Th>Warehouse</Th><Th>Product</Th><Th>SKU</Th><Th className="text-right">On-hand</Th><Th className="text-right">Avg cost</Th><Th className="text-right">Value</Th></tr></thead>
                <tbody>
                  {valuationRows.map((row, index) => (
                    <tr key={`${row.warehouseCode}-${row.sku}-${index}`}>
                      <Td>{row.warehouse}</Td>
                      <Td>{row.product}</Td>
                      <Td className="font-mono text-xs">{row.sku}</Td>
                      <Td className="text-right">{row.onHand}</Td>
                      <Td className="text-right">{money(row.avgCost)}</Td>
                      <Td className="text-right">{money(row.value)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
