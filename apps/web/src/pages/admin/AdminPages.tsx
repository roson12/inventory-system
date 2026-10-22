import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import type { Settings } from '@/types';

interface RoleRow {
  role: string;
  permissions: string[];
}
interface PermissionDefinition {
  key: string;
  description: string;
  category: string;
}

export function RolesPage() {
  const { me } = useAuth();
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const permissions = useQuery({ queryKey: ['permission-catalog'], queryFn: () => api<PermissionDefinition[]>('/roles/permissions') });

  useEffect(() => {
    if (roles.data) {
      const map: Record<string, string[]> = {};
      for (const row of roles.data) map[row.role] = row.permissions;
      setSelection(map);
    }
  }, [roles.data]);

  if (roles.isLoading || permissions.isLoading) return <Skeleton className="h-64" />;
  if (roles.error) return <ErrorState message={(roles.error as Error).message} />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Role permissions are evaluated deny-by-default. Super Admin always has every permission and cannot be reduced.
      </p>
      {roles.data!.map((row) => {
        const editable = me?.role === 'SUPER_ADMIN' && row.role !== 'SUPER_ADMIN';
        return (
          <Card key={row.role}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{row.role.replaceAll('_', ' ')}</CardTitle>
              {editable ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await api(`/roles/${row.role}/permissions`, {
                        method: 'PUT',
                        body: { permissions: selection[row.role] ?? [] },
                      });
                      toast.success(`${row.role} permissions saved`);
                      await roles.refetch();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'Save failed');
                    }
                  }}
                >
                  Save
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(permissions.data ?? []).map((permission) => (
                <label key={permission.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!editable}
                    checked={(selection[row.role] ?? []).includes(permission.key)}
                    onChange={(event) => {
                      const current = new Set(selection[row.role] ?? []);
                      if (event.target.checked) current.add(permission.key);
                      else current.delete(permission.key);
                      setSelection({ ...selection, [row.role]: [...current] });
                    }}
                  />
                  <span>
                    <span className="font-mono text-xs">{permission.key}</span>
                    <span className="block text-xs text-muted-foreground">{permission.description}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
  before: unknown;
  after: unknown;
}

export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const logs = useQuery({
    queryKey: ['audit-logs', page, action],
    queryFn: () => apiPage<AuditRow>(`/audit-logs?page=${page}&pageSize=30${action ? `&action=${encodeURIComponent(action)}` : ''}`),
  });

  return (
    <div className="space-y-4">
      <Input placeholder="Filter by action (e.g. orders.confirmed)" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} className="max-w-md" />
      {logs.isLoading ? (
        <Skeleton className="h-64" />
      ) : logs.error ? (
        <ErrorState message={(logs.error as Error).message} />
      ) : (
        <>
          <Table>
            <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>IP</Th><Th>Details</Th></tr></thead>
            <tbody>
              {logs.data!.data.map((log) => (
                <tr key={log.id}>
                  <Td className="whitespace-nowrap">{formatDate(log.createdAt, true)}</Td>
                  <Td>{log.actor?.name ?? 'System'}<p className="text-xs text-slate-500">{log.actor?.email}</p></Td>
                  <Td className="font-mono text-xs">{log.action}</Td>
                  <Td>{log.entityType}<p className="font-mono text-xs text-slate-500">{log.entityId ?? '—'}</p></Td>
                  <Td className="text-xs">{log.ip ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-xs text-slate-500">{JSON.stringify(log.after ?? log.before ?? {})}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= logs.data!.meta.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  if (settings.isLoading || !form) return <Skeleton className="h-64" />;
  if (settings.error) return <ErrorState message={(settings.error as Error).message} />;

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>System settings</CardTitle></CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api('/settings', {
                method: 'PUT',
                body: {
                  ...form,
                  purchaseApprovalLimit: Number(form.purchaseApprovalLimit),
                  defaultTaxRate: Number(form.defaultTaxRate),
                },
              });
              toast.success('Settings saved');
              await queryClient.invalidateQueries({ queryKey: ['settings'] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Save failed');
            }
          }}
        >
          <Field label="Company name"><Input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /></Field>
          <Field label="Currency code"><Input maxLength={3} value={form.currencyCode} onChange={(event) => setForm({ ...form, currencyCode: event.target.value.toUpperCase() })} /></Field>
          <Field label="Purchase approval limit" hint="Orders above this total require unlimited approval permission."><Input type="number" min="0" step="0.01" value={form.purchaseApprovalLimit} onChange={(event) => setForm({ ...form, purchaseApprovalLimit: event.target.value })} /></Field>
          <Field label="Default tax rate %"><Input type="number" min="0" max="100" step="0.01" value={form.defaultTaxRate} onChange={(event) => setForm({ ...form, defaultTaxRate: event.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowNegativeStock} onChange={(event) => setForm({ ...form, allowNegativeStock: event.target.checked })} /> Allow negative stock</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.taxEnabled} onChange={(event) => setForm({ ...form, taxEnabled: event.target.checked })} /> Tax enabled</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.lowStockNotifications} onChange={(event) => setForm({ ...form, lowStockNotifications: event.target.checked })} /> Low-stock notifications</label>
          <div className="sm:col-span-2"><Button type="submit">Save settings</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
