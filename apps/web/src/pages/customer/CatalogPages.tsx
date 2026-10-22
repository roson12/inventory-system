import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Package, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { money, qty } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Skeleton,
} from '@/components/ui';
import type { Category, Product } from '@/types';

export function CatalogPage() {
  const { me } = useAuth();
  const { add } = useCart();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const products = useQuery({
    queryKey: ['catalog', search, categoryId, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '12' });
      if (search) params.set('search', search);
      if (categoryId) params.set('categoryId', categoryId);
      return apiPage<Product>(`/products?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name, SKU, or barcode"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-sm"
          aria-label="Search products"
        />
        <Select
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      {products.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      ) : products.error ? (
        <ErrorState message={(products.error as Error).message} retry={() => void products.refetch()} />
      ) : products.data!.data.length === 0 ? (
        <EmptyState title="No products found" description="Try a different search term or category." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.data!.data.map((product) => (
              <Card key={product.id} className="flex flex-col overflow-hidden">
                <Link to={`/catalog/${product.id}`} className="block">
                  <div className="flex h-36 items-center justify-center bg-slate-100">
                    {product.images[0] ? (
                      <img
                        src={product.images[0].url}
                        alt={product.images[0].altText ?? product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-10 w-10 text-slate-300" />
                    )}
                  </div>
                </Link>
                <CardContent className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/catalog/${product.id}`} className="font-medium hover:underline">
                      {product.name}
                    </Link>
                    <Badge status={Number(product.available) > 0 ? 'ACTIVE' : 'INACTIVE'}>
                      {Number(product.available) > 0 ? 'In stock' : 'Out of stock'}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-slate-500">{product.sku}</p>
                  <p className="text-lg font-semibold">{money(product.sellingPrice)}</p>
                  <p className="text-xs text-muted-foreground">{qty(product.available)} {product.unitOfMeasure} available</p>
                  <div className="mt-auto">
                    {me?.role === 'CUSTOMER' ? (
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={Number(product.available) <= 0}
                        onClick={() => {
                          add(product, 1);
                          toast.success(`${product.name} added to cart`);
                        }}
                      >
                        <ShoppingCart className="h-4 w-4" /> Add to cart
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="w-full" disabled>
                        Customer purchase only
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination page={products.data!.meta.page} totalPages={products.data!.meta.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);

  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => api<Product>(`/products/${id}`),
    enabled: Boolean(id),
  });

  if (product.isLoading) return <Skeleton className="h-80" />;
  if (product.error) return <ErrorState message={(product.error as Error).message} />;
  const item = product.data!;

  return (
    <div className="space-y-4">
      <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </Link>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex h-80 items-center justify-center bg-slate-100">
            {item.images[0] ? (
              <img src={item.images[0].url} alt={item.name} className="h-full w-full object-cover" />
            ) : (
              <Package className="h-16 w-16 text-slate-300" />
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <div>
            <p className="font-mono text-xs text-slate-500">{item.sku}</p>
            <h2 className="text-2xl font-semibold">{item.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{item.category?.name ?? 'Uncategorized'}</p>
          </div>
          <p className="text-2xl font-semibold">{money(item.sellingPrice)}</p>
          <p className="text-sm text-slate-600">
            {qty(item.available)} {item.unitOfMeasure} available
          </p>
          <p className="whitespace-pre-line text-sm text-slate-700">{item.description ?? 'No description.'}</p>
          {me?.role === 'CUSTOMER' ? (
            <div className="flex items-end gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="quantity">
                  Quantity
                </label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={Math.max(1, Number(item.available))}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
                  className="w-24"
                />
              </div>
              <Button
                disabled={Number(item.available) <= 0}
                onClick={() => {
                  add(item, quantity);
                  toast.success('Added to cart');
                }}
              >
                <ShoppingCart className="h-4 w-4" /> Add to cart
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
