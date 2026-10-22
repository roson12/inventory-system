import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
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
  Th,
} from '@/components/ui';
import type { Role, UserRecord, Warehouse } from '@/types';

interface PermissionDefinition {
  key: string;
  description: string;
  category: string;
}

export function UsersPage() {
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [permOpen, setPermOpen] = useState<UserRecord | null>(null);
  const [overrides, setOverrides] = useState<Record<string, 'ALLOW' | 'DENY' | 'DEFAULT'>>({});
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' as Role, warehouseIds: [] as string[] });

  const users = useQuery({
    queryKey: ['users', search, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      return apiPage<UserRecord>(`/users?${params.toString()}`);
    },
  });
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
  const permissions = useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => api<PermissionDefinition[]>('/roles/permissions'),
  });

  async function create() {
    try {
      await api('/users', { method: 'POST', body: form });
      toast.success('User created');
      setCreateOpen(false);
      setForm({ name: '', email: '', password: '', role: 'STAFF', warehouseIds: [] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create user');
    }
  }

  async function toggleStatus(user: UserRecord) {
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: { status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      toast.success('User updated');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    }
  }

  async function openPermissions(user: UserRecord) {
    try {
      const detail = await api<{ permissionOverrides: { permissionKey: string; effect: 'ALLOW' | 'DENY' }[] }>(`/users/${user.id}`);
      const map: Record<string, 'ALLOW' | 'DENY' | 'DEFAULT'> = {};
      for (const override of detail.permissionOverrides) map[override.permissionKey] = override.effect;
      setOverrides(map);
      setPermOpen(user);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load permissions');
    }
  }

  async function savePermissions() {
    if (!permOpen) return;
    try {
      const payload = Object.entries(overrides)
        .filter(([, effect]) => effect !== 'DEFAULT')
        .map(([permissionKey, effect]) => ({ permissionKey, effect }));
      await api(`/users/${permOpen.id}/permissions`, { method: 'PUT', body: { overrides: payload } });
      toast.success('Permissions updated');
      setPermOpen(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save permissions');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input placeholder="Search name or email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="max-w-sm" />
        {can('users.read') ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New user</Button> : null}
      </div>

      {users.isLoading ? (
        <Skeleton className="h-64" />
      ) : users.error ? (
        <ErrorState message={(users.error as Error).message} />
      ) : users.data!.data.length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <>
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Warehouses</Th><Th>Last login</Th><Th /></tr></thead>
            <tbody>
              {users.data!.data.map((user) => (
                <tr key={user.id}>
                  <Td className="font-medium">{user.name}</Td>
                  <Td>{user.email}</Td>
                  <Td><Badge className="bg-slate-100 text-slate-700">{user.role.replaceAll('_', ' ')}</Badge></Td>
                  <Td><Badge status={user.status} /></Td>
                  <Td className="text-xs">{user.warehouseAssignments?.map((a) => a.warehouse.code).join(', ') || 'All / none'}</Td>
                  <Td>{formatDate(user.lastLoginAt, true)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {me?.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN' ? (
                        <Button size="sm" variant="outline" onClick={() => void openPermissions(user)}>Permissions</Button>
                      ) : null}
                      {me?.id !== user.id && user.role !== 'SUPER_ADMIN' ? (
                        <Button size="sm" variant="ghost" onClick={() => void toggleStatus(user)}>
                          {user.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={users.data!.meta.page} totalPages={users.data!.meta.totalPages} onPage={setPage} />
        </>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Provision user"
        description="Administrative accounts are never created through public registration."
        footer={<><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void create()} disabled={!form.name || !form.email || form.password.length < 10}>Create</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Temporary password"><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
              <option value="CUSTOMER">Customer</option>
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
              {me?.role === 'SUPER_ADMIN' ? <option value="SUPER_ADMIN">Super Admin</option> : null}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Warehouse assignments" hint="Staff see only assigned warehouses. Admins with no assignment see all.">
              <div className="grid gap-1 rounded-md border p-3">
                {(warehouses.data ?? []).map((warehouse) => (
                  <label key={warehouse.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.warehouseIds.includes(warehouse.id)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          warehouseIds: event.target.checked
                            ? [...form.warehouseIds, warehouse.id]
                            : form.warehouseIds.filter((id) => id !== warehouse.id),
                        })
                      }
                    />
                    {warehouse.name}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(permOpen)}
        onClose={() => setPermOpen(null)}
        title={`Permission overrides — ${permOpen?.name ?? ''}`}
        description="DENY wins over role grants. Default follows the role."
        wide
        footer={<><Button variant="outline" onClick={() => setPermOpen(null)}>Cancel</Button><Button onClick={() => void savePermissions()}>Save overrides</Button></>}
      >
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {(permissions.data ?? []).map((permission) => (
            <div key={permission.key} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
              <div>
                <p className="font-mono text-xs">{permission.key}</p>
                <p className="text-xs text-muted-foreground">{permission.description}</p>
              </div>
              <Select
                className="w-36"
                value={overrides[permission.key] ?? 'DEFAULT'}
                onChange={(event) => setOverrides({ ...overrides, [permission.key]: event.target.value as 'ALLOW' | 'DENY' | 'DEFAULT' })}
              >
                <option value="DEFAULT">Default</option>
                <option value="ALLOW">Allow</option>
                <option value="DENY">Deny</option>
              </Select>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
