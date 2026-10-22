import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiForm, apiPage } from '@/lib/api';
import { money, qty } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
import type { Category, Product } from '@/types';

interface FormState {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  categoryId: string;
  unitOfMeasure: string;
  costPrice: string;
  sellingPrice: string;
  reorderLevel: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  sku: '',
  barcode: '',
  name: '',
  description: '',
  categoryId: '',
  unitOfMeasure: 'unit',
  costPrice: '0',
  sellingPrice: '0',
  reorderLevel: '0',
  isActive: true,
};

export function ProductsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const products = useQuery({
    queryKey: ['manage-products', search, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search) params.set('search', search);
      return apiPage<Product>(`/products/manage/list?${params.toString()}`);
    },
  });
  const categories = useQuery({ queryKey: ['categories-manage'], queryFn: () => api<Category[]>('/categories/manage') });

  function openCreate() {
    setForm(emptyForm);
    setImageFile(null);
    setDialogOpen(true);
  }
  function openEdit(product: Product) {
    setForm({
      id: product.id,
      sku: product.sku,
      barcode: product.barcode ?? '',
      name: product.name,
      description: product.description ?? '',
      categoryId: product.category?.id ?? '',
      unitOfMeasure: product.unitOfMeasure,
      costPrice: product.costPrice ?? '0',
      sellingPrice: product.sellingPrice,
      reorderLevel: product.reorderLevel,
      isActive: product.isActive,
    });
    setImageFile(null);
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...form,
        categoryId: form.categoryId || null,
        barcode: form.barcode || null,
        description: form.description || null,
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        reorderLevel: Number(form.reorderLevel),
      };
      const saved = form.id
        ? await api<Product>(`/products/${form.id}`, { method: 'PATCH', body })
        : await api<Product>('/products', { method: 'POST', body });
      if (imageFile) {
        const data = new FormData();
        data.append('image', imageFile);
        await apiForm(`/products/${saved.id}/images`, data);
      }
      toast.success(form.id ? 'Product updated' : 'Product created');
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['manage-products'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function archive(product: Product) {
    if (!window.confirm(`Archive ${product.name}? It will no longer be sold.`)) return;
    try {
      await api(`/products/${product.id}/archive`, { method: 'POST' });
      toast.success('Product archived');
      await queryClient.invalidateQueries({ queryKey: ['manage-products'] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Archive failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <div className="relative sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search products"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        {can('products.write') ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New product
          </Button>
        ) : null}
      </div>

      {products.isLoading ? (
        <Skeleton className="h-64" />
      ) : products.error ? (
        <ErrorState message={(products.error as Error).message} retry={() => void products.refetch()} />
      ) : products.data!.data.length === 0 ? (
        <EmptyState title="No products" description="Create your first product." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU / Barcode</Th>
                <Th>Category</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Price</Th>
                <Th className="text-right">Available</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {products.data!.data.map((product) => (
                <tr key={product.id}>
                  <Td className="font-medium">{product.name}</Td>
                  <Td>
                    <p className="font-mono text-xs">{product.sku}</p>
                    {product.barcode ? <p className="font-mono text-xs text-slate-500">{product.barcode}</p> : null}
                  </Td>
                  <Td>{product.category?.name ?? '—'}</Td>
                  <Td className="text-right">{money(product.costPrice)}</Td>
                  <Td className="text-right">{money(product.sellingPrice)}</Td>
                  <Td className="text-right">{qty(product.available)}</Td>
                  <Td><Badge status={product.isActive ? 'ACTIVE' : 'INACTIVE'} /></Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {can('products.write') ? (
                        <Button size="sm" variant="outline" onClick={() => openEdit(product)}>Edit</Button>
                      ) : null}
                      {can('products.archive') && product.isActive ? (
                        <Button size="sm" variant="ghost" onClick={() => void archive(product)}>Archive</Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={products.data!.meta.page} totalPages={products.data!.meta.totalPages} onPage={setPage} />
        </>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={form.id ? 'Edit product' : 'New product'}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || !form.name || !form.sku}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="SKU">
            <Input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
          </Field>
          <Field label="Barcode">
            <Input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">Uncategorized</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit of measure">
            <Input value={form.unitOfMeasure} onChange={(event) => setForm({ ...form, unitOfMeasure: event.target.value })} />
          </Field>
          <Field label="Reorder level">
            <Input type="number" min="0" step="0.001" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} />
          </Field>
          <Field label="Cost price">
            <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} />
          </Field>
          <Field label="Selling price">
            <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </Field>
          </div>
          <Field label="Image" hint="JPEG, PNG, WebP, or GIF up to 5 MB.">
            <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Active
          </label>
        </div>
      </Dialog>
    </div>
  );
}
