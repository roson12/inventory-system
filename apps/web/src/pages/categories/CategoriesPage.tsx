import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Table, Td, Textarea, Th } from '@/components/ui';
import type { Category } from '@/types';

export function CategoriesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', description: '', parentId: '' });

  const categories = useQuery({ queryKey: ['categories-manage'], queryFn: () => api<Category[]>('/categories/manage') });

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', parentId: '' });
    setOpen(true);
  }
  function openEdit(category: Category) {
    setEditing(category);
    setForm({ name: category.name, description: category.description ?? '', parentId: category.parentId ?? '' });
    setOpen(true);
  }

  async function save() {
    try {
      const body = { name: form.name, description: form.description || null, parentId: form.parentId || null };
      if (editing) await api(`/categories/${editing.id}`, { method: 'PATCH', body });
      else await api('/categories', { method: 'POST', body });
      toast.success(editing ? 'Category updated' : 'Category created');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['categories-manage'] });
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    }
  }

  if (categories.isLoading) return <Skeleton className="h-64" />;
  if (categories.error) return <ErrorState message={(categories.error as Error).message} />;

  return (
    <div className="space-y-4">
      {can('categories.write') ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}><Plus className="h-4 w-4" /> New category</Button>
        </div>
      ) : null}
      {categories.data!.length === 0 ? (
        <EmptyState title="No categories" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Parent</Th>
              <Th>Products</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {categories.data!.map((category) => (
              <tr key={category.id}>
                <Td>
                  <p className="font-medium">{category.name}</p>
                  <p className="font-mono text-xs text-slate-500">{category.slug}</p>
                </Td>
                <Td>{categories.data!.find((c) => c.id === category.parentId)?.name ?? '—'}</Td>
                <Td>{category._count?.products ?? 0}</Td>
                <Td><Badge status={category.isActive ? 'ACTIVE' : 'INACTIVE'} /></Td>
                <Td>
                  {can('categories.write') ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(category)}>Edit</Button>
                      {category.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await api(`/categories/${category.id}/deactivate`, { method: 'POST' });
                              toast.success('Category deactivated');
                              await queryClient.invalidateQueries({ queryKey: ['categories-manage'] });
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : 'Failed');
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      ) : null}
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
        title={editing ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={!form.name}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Parent category">
            <Select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
              <option value="">None</option>
              {categories.data!.filter((c) => c.id !== editing?.id).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
