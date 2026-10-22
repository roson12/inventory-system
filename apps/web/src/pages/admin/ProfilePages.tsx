import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, money } from '@/lib/utils';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import type { Notification } from '@/types';

export function ProfilePage() {
  const { me, logout, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    addressLine1: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  });

  useEffect(() => {
    if (me) {
      setProfile({
        name: me.name,
        phone: me.phone ?? '',
        addressLine1: me.customer?.addressLine1 ?? '',
        city: me.customer?.city ?? '',
        region: me.customer?.region ?? '',
        postalCode: me.customer?.postalCode ?? '',
        country: me.customer?.country ?? '',
      });
    }
  }, [me]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Name:</span> {me?.name}</p>
          <p><span className="text-muted-foreground">Email:</span> {me?.email}</p>
          <p><span className="text-muted-foreground">Phone:</span> {me?.phone ?? '—'}</p>
          <p><span className="text-muted-foreground">Role:</span> {me?.role.replaceAll('_', ' ').toLowerCase()}</p>
          {me?.warehouses.length ? (
            <p><span className="text-muted-foreground">Warehouses:</span> {me.warehouses.map((w) => w.name).join(', ')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Edit profile</CardTitle></CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api('/auth/profile', {
                  method: 'PATCH',
                  body: {
                    name: profile.name,
                    phone: profile.phone || null,
                    ...(me?.role === 'CUSTOMER'
                      ? {
                          addressLine1: profile.addressLine1 || null,
                          city: profile.city || null,
                          region: profile.region || null,
                          postalCode: profile.postalCode || null,
                          country: profile.country || null,
                        }
                      : {}),
                  },
                });
                await refresh();
                toast.success('Profile updated');
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Update failed');
              }
            }}
          >
            <Field label="Name"><Input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></Field>
            <Field label="Phone"><Input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></Field>
            {me?.role === 'CUSTOMER' ? (
              <>
                <div className="sm:col-span-2"><Field label="Address"><Input value={profile.addressLine1} onChange={(event) => setProfile({ ...profile, addressLine1: event.target.value })} /></Field></div>
                <Field label="City"><Input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} /></Field>
                <Field label="Region"><Input value={profile.region} onChange={(event) => setProfile({ ...profile, region: event.target.value })} /></Field>
                <Field label="Postal code"><Input value={profile.postalCode} onChange={(event) => setProfile({ ...profile, postalCode: event.target.value })} /></Field>
                <Field label="Country"><Input value={profile.country} onChange={(event) => setProfile({ ...profile, country: event.target.value })} /></Field>
              </>
            ) : null}
            <div className="sm:col-span-2"><Button type="submit">Save profile</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api('/auth/password/change', {
                  method: 'POST',
                  body: { currentPassword, newPassword },
                });
                toast.success('Password changed');
                setCurrentPassword('');
                setNewPassword('');
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Change failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Current password">
              <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </Field>
            <Field label="New password" hint="At least 10 characters with a letter and a number.">
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!window.confirm('Revoke all sessions, including this one?')) return;
                  try {
                    await api('/auth/sessions/revoke-all', { method: 'POST' });
                    await logout();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not revoke sessions');
                  }
                }}
              >
                Revoke all sessions
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
  });

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] }),
    ]);
  }

  if (notifications.isLoading) return <Skeleton className="h-64" />;
  if (notifications.error) return <ErrorState message={(notifications.error as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void markAll()}>Mark all read</Button>
      </div>
      {notifications.data!.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <div className="space-y-2">
          {notifications.data!.map((notification) => (
            <Card key={notification.id} className={notification.isRead ? 'opacity-70' : ''}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(notification.createdAt, true)}</p>
                </div>
                {!notification.isRead ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/notifications/${notification.id}/read`, { method: 'POST' });
                      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
                    }}
                  >
                    Mark read
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
