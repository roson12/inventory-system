import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { money, qty } from '@/lib/utils';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, Table, Td, Textarea, Th } from '@/components/ui';
import type { CustomerOrder } from '@/types';

export function CartPage() {
  const { items, update, remove, total, clear } = useCart();
  const { me } = useAuth();

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Browse the catalog to add products."
        action={
          <Link to="/catalog">
            <Button className="mt-2">Browse catalog</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Price</Th>
              <Th>Quantity</Th>
              <Th className="text-right">Line total</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.product.id}>
                <Td>
                  <Link to={`/catalog/${item.product.id}`} className="font-medium hover:underline">
                    {item.product.name}
                  </Link>
                  <p className="font-mono text-xs text-slate-500">{item.product.sku}</p>
                </Td>
                <Td>{money(item.product.sellingPrice)}</Td>
                <Td>
                  <Input
                    type="number"
                    min={1}
                    max={Math.max(1, Number(item.product.available))}
                    value={item.quantity}
                    onChange={(event) => update(item.product.id, Math.max(0, Number(event.target.value)))}
                    className="w-24"
                    aria-label={`Quantity for ${item.product.name}`}
                  />
                </Td>
                <Td className="text-right">{money(Number(item.product.sellingPrice) * item.quantity)}</Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => remove(item.product.id)} aria-label="Remove item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Button variant="ghost" size="sm" className="mt-2" onClick={clear}>
          Clear cart
        </Button>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Items</span>
            <span>{items.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{money(total)}</span>
          </div>
          <div className="flex justify-between border-t pt-3 text-base font-semibold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          {me?.role === 'CUSTOMER' ? (
            <Link to="/checkout">
              <Button className="w-full">Proceed to checkout</Button>
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">Only Customer accounts can check out.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function CheckoutPage() {
  const { items, total, clear } = useCart();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    shippingName: me?.name ?? '',
    shippingPhone: me?.phone ?? '',
    shippingAddress: '',
    notes: '',
  });

  if (items.length === 0) {
    return <EmptyState title="Nothing to check out" description="Your cart is empty." action={<Link to="/catalog"><Button>Browse catalog</Button></Link>} />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const order = await api<CustomerOrder>('/orders', {
        method: 'POST',
        body: {
          ...form,
          items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        },
      });
      clear();
      toast.success(`Order ${order.orderNumber} placed — awaiting confirmation`);
      navigate(`/orders/${order.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not place order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Shipping details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Recipient name">
            <Input
              required
              value={form.shippingName}
              onChange={(event) => setForm({ ...form, shippingName: event.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.shippingPhone}
              onChange={(event) => setForm({ ...form, shippingPhone: event.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Shipping address">
              <Textarea
                required
                value={form.shippingAddress}
                onChange={(event) => setForm({ ...form, shippingAddress: event.target.value })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Order notes (optional)">
              <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Order summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between text-sm">
              <span>
                {item.product.name} × {qty(item.quantity)}
              </span>
              <span>{money(Number(item.product.sellingPrice) * item.quantity)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-3 font-semibold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            No online payment is taken. Your order is a request and is confirmed by staff when stock is reserved.
          </p>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Placing order…' : 'Place order'}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
