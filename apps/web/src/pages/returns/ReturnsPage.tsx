import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money, qty } from '@/lib/utils';
import { Badge, Button, EmptyState, ErrorState, Skeleton, Table, Td, Th } from '@/components/ui';
import type { ReturnRecord } from '@/types';

export function ReturnsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const returns = useQuery({ queryKey: ['returns'], queryFn: () => api<ReturnRecord[]>('/returns') });

  async function act(id: string, action: 'approve' | 'reject' | 'receive') {
    try {
      await api(`/returns/${id}/${action}`, { method: 'POST' });
      toast.success(`Return ${action}d`);
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  }

  if (returns.isLoading) return <Skeleton className="h-64" />;
  if (returns.error) return <ErrorState message={(returns.error as Error).message} retry={() => void returns.refetch()} />;
  if (returns.data!.length === 0) {
    return <EmptyState title="No returns" description="Return requests against delivered orders will appear here." />;
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Return</Th>
          <Th>Order</Th>
          <Th>Customer</Th>
          <Th>Status</Th>
          <Th>Items</Th>
          <Th className="text-right">Refund</Th>
          <Th>Requested</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {returns.data!.map((row) => (
          <tr key={row.id}>
            <Td className="font-medium">{row.returnNumber}</Td>
            <Td>{row.order.orderNumber}</Td>
            <Td>{row.customer?.name ?? 'You'}</Td>
            <Td><Badge status={row.status} /></Td>
            <Td>
              {row.items.map((item) => (
                <p key={item.id} className="text-xs">
                  {item.product.name} × {qty(item.quantity)}
                </p>
              ))}
            </Td>
            <Td className="text-right">{money(row.refundAmount)}</Td>
            <Td>{formatDate(row.requestedAt)}</Td>
            <Td>
              {can('returns.manage') ? (
                <div className="flex justify-end gap-1">
                  {row.status === 'REQUESTED' ? (
                    <>
                      <Button size="sm" onClick={() => void act(row.id, 'approve')}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => void act(row.id, 'reject')}>Reject</Button>
                    </>
                  ) : null}
                  {row.status === 'APPROVED' ? (
                    <Button size="sm" onClick={() => void act(row.id, 'receive')}>Receive & restock</Button>
                  ) : null}
                </div>
              ) : null}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
