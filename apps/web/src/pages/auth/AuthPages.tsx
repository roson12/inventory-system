import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button, Card, CardContent, Field, Input } from '@/components/ui';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

const registerSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
});
type RegisterValues = z.infer<typeof registerSchema>;

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Inventory System</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Card>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, me } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (me) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      toast.success('Welcome back');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthFrame title="Sign in" subtitle="Use your account credentials to continue.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p> : null}
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
          {form.formState.errors.password ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p> : null}
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <Link to="/forgot-password" className="text-slate-600 hover:underline">
          Forgot password?
        </Link>
        <Link to="/register" className="font-medium text-slate-900 hover:underline">
          Create customer account
        </Link>
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-medium">Demo accounts (seeded)</p>
        <p>superadmin@example.com · ChangeMe!SuperAdmin123</p>
        <p>admin@example.com · Admin123!Pass</p>
        <p>staff@example.com · Staff123!Pass</p>
        <p>customer@example.com · Customer123!Pass</p>
      </div>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { register: registerUser, me } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  if (me) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await registerUser(values);
      toast.success('Account created');
      navigate('/catalog');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthFrame title="Create account" subtitle="Customer accounts can browse the catalog and place orders.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name">
          <Input {...form.register('name')} />
          {form.formState.errors.name ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.name.message}</p> : null}
        </Field>
        <Field label="Email">
          <Input type="email" {...form.register('email')} />
          {form.formState.errors.email ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p> : null}
        </Field>
        <Field label="Phone (optional)">
          <Input {...form.register('phone')} />
        </Field>
        <Field label="Password" hint="At least 10 characters, with a letter and a number.">
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
          {form.formState.errors.password ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p> : null}
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-slate-900 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  return (
    <AuthFrame title="Reset password" subtitle="We will send a single-use reset link if the account exists.">
      {done ? (
        <div className="space-y-4 text-sm text-slate-700">
          <p>If an account exists for that email, a reset link has been sent. The link expires in 60 minutes.</p>
          <Link to="/login" className="font-medium text-slate-900 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api('/auth/password/forgot', { method: 'POST', body: { email } });
              setDone(true);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Request failed');
            }
          }}
        >
          <Field label="Email">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Button type="submit" className="w-full">
            Send reset link
          </Button>
          <Link to="/login" className="block text-sm text-slate-600 hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <AuthFrame title="Choose a new password" subtitle="The reset link is single-use and expires after 60 minutes.">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirm) {
            toast.error('Passwords do not match');
            return;
          }
          setSubmitting(true);
          try {
            await api('/auth/password/reset', { method: 'POST', body: { token, password } });
            toast.success('Password updated. Sign in with your new password.');
            navigate('/login');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Reset failed');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {!token ? <p className="text-sm text-red-600">This link is missing its token.</p> : null}
        <Field label="New password">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <Field label="Confirm password">
          <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={!token || submitting}>
          {submitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthFrame>
  );
}
