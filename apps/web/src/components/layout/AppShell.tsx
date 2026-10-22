import { useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeftRight,
  Bell,
  Boxes,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  Settings,
  ShoppingCart,
  ShoppingBag,
  Store,
  Tags,
  Truck,
  Undo2,
  User,
  Users,
  Warehouse as WarehouseIcon,
  Wrench,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { cn, statusLabel } from '@/lib/utils';
import { Badge } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: string | string[];
  roles?: string[];
  end?: boolean;
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/catalog', label: 'Catalog', icon: Store },
      { to: '/orders', label: 'Orders', icon: ShoppingBag },
      { to: '/returns', label: 'Returns', icon: Undo2 },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/inventory', label: 'Stock', icon: Boxes, permission: 'inventory.read' },
      { to: '/movements', label: 'Movements', icon: ScrollText, permission: 'inventory.read' },
      { to: '/adjustments', label: 'Adjustments', icon: Wrench, permission: 'inventory.read' },
      { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, permission: 'inventory.read' },
      { to: '/warehouses', label: 'Warehouses', icon: WarehouseIcon, permission: 'warehouses.read' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: Package, permission: ['products.write', 'products.archive'] },
      { to: '/categories', label: 'Categories', icon: Tags, permission: 'categories.write' },
    ],
  },
  {
    label: 'Procurement',
    items: [
      { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'suppliers.read' },
      { to: '/purchase-orders', label: 'Purchase Orders', icon: ClipboardList, permission: 'purchase_orders.read' },
      { to: '/goods-receipts', label: 'Goods Receipts', icon: Archive, permission: ['goods_receipts.create', 'purchase_orders.read'] },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/reports', label: 'Reports', icon: FileBarChart, permission: ['reports.view', 'reports.financial'] }],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: Users, permission: 'users.read' },
      { to: '/roles', label: 'Roles', icon: Users, permission: ['users.read', 'roles.manage'] },
      { to: '/audit-logs', label: 'Audit Log', icon: ScrollText, permission: 'audit.read' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: ['settings.manage', 'settings.read'] },
    ],
  },
];

export function AppShell() {
  const { me, can, logout } = useAuth();
  const { count } = useCart();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const { data: notifications } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const allowed = (item: NavItem) => {
    if (item.roles && me && !item.roles.includes(me.role)) return false;
    if (!item.permission) return true;
    const permissions = Array.isArray(item.permission) ? item.permission : [item.permission];
    return permissions.some((permission) => can(permission));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto bg-slate-900 text-slate-200 transition-transform lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <Package className="h-5 w-5" />
            Inventory
          </Link>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-5 px-3 pb-8">
          {groups.map((group) => {
            const items = group.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                          isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Signed in as</p>
              <p className="text-sm font-medium text-slate-800">
                {me?.name} · <span className="capitalize">{me?.role.replaceAll('_', ' ').toLowerCase()}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {me?.role === 'CUSTOMER' ? (
              <Link to="/cart" className="relative rounded-md p-2 hover:bg-slate-100" aria-label="Cart">
                <ShoppingCart className="h-5 w-5" />
                {count > 0 ? (
                  <span className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1.5 text-[10px] font-semibold text-white">
                    {count}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <Link to="/notifications" className="relative rounded-md p-2 hover:bg-slate-100" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {(notifications?.count ?? 0) > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                  {notifications!.count}
                </span>
              ) : null}
            </Link>
            <div className="relative">
              <button
                onClick={() => setUserMenu((open) => !open)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100"
                aria-haspopup="menu"
                aria-expanded={userMenu}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {me?.name?.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{me?.name}</span>
              </button>
              {userMenu ? (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-48 rounded-md border bg-white py-1 shadow-lg"
                  onMouseLeave={() => setUserMenu(false)}
                >
                  <Link to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                    <User className="h-4 w-4" /> Profile
                  </Link>
                  <Link to="/notifications" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                    <Bell className="h-4 w-4" /> Notifications
                  </Link>
                  <button
                    onClick={() => {
                      setUserMenu(false);
                      navigate('/profile');
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => void logout()}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold capitalize text-slate-900">
              {titleFor(location.pathname)}
            </h1>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  const segment = pathname.split('/')[1];
  const titles: Record<string, string> = {
    catalog: 'Product catalog',
    cart: 'Cart',
    checkout: 'Checkout',
    orders: 'Orders',
    returns: 'Returns',
    inventory: 'Inventory',
    movements: 'Stock movements',
    adjustments: 'Stock adjustments',
    transfers: 'Stock transfers',
    warehouses: 'Warehouses',
    products: 'Products',
    categories: 'Categories',
    suppliers: 'Suppliers',
    'purchase-orders': 'Purchase orders',
    'goods-receipts': 'Goods receipts',
    reports: 'Reports',
    users: 'Users',
    roles: 'Roles',
    'audit-logs': 'Audit log',
    settings: 'Settings',
    notifications: 'Notifications',
    profile: 'Profile',
  };
  return titles[segment] ?? statusLabel(segment ?? '');
}
