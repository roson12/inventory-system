import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money } from '@/lib/utils';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Input, Skeleton, Table, Td, Textarea, Th } from '@/components/ui';
import type { Supplier } from '@/types';

export function SuppliersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });

  function openCreate() {
    setEditing(null);
    setForm({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' });
    setOpen(true);
  }
  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      email: supplier.email ?? '',
      phone: supplier.phone ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    });
    setOpen(true);
  }
  async function save() {
    try {
      const body = { ...form, email: form.email || null, contactName: form.contactName || null, phone: form.phone || null, address: form.address || null, notes: form.notes || null };
      if (editing) await api(`/suppliers/${editing.id}`, { method: 'PATCH', body });
      else await api('/suppliers', { method: 'POST', body });
      toast.success(editing ? 'Supplier updated' : 'Supplier created');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    }
  }

  if (suppliers.isLoading) return <Skeleton className="h-64" />;
  if (suppliers.error) return <ErrorState message={(suppliers.error as Error).message} />;

  return (
    <div className="space-y-4">
      {can('suppliers.write') ? (
        <div className="flex justify-end"><Button onClick={openCreate}><Plus className="h-4 w-4" /> New supplier</Button></div>
      ) : null}
      {suppliers.data!.length === 0 ? (
        <EmptyState title="No suppliers" />
      ) : (
        <Table>
          <thead>
            <tr><Th>Name</Th><Th>Contact</Th><Th>Email</Th><Th>Phone</Th><Th>Linked products</Th><Th>Status</Th><Th /></tr>
          </thead>
          <tbody>
            {suppliers.data!.map((supplier) => (
              <tr key={supplier.id}>
                <Td className="font-medium">{supplier.name}</Td>
                <Td>{supplier.contactName ?? '—'}</Td>
                <Td>{supplier.email ?? '—'}</Td>
                <Td>{supplier.phone ?? '—'}</Td>
                <Td>{supplier.products?.length ?? 0}</Td>
                <Td><Badge status={supplier.isActive ? 'ACTIVE' : 'INACTIVE'} /></Td>
                <Td>{can('suppliers.write') ? <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => openEdit(supplier)}>Edit</Button></div> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit supplier' : 'New supplier'}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={!form.name}>Save</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Contact name"><Input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Address"><Textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field></div>
        </div>
      </Dialog>
    </div>
  );
}
