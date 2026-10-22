import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
    size?: 'sm' | 'md';
  }
>(({ className, variant = 'default', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
      size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
      variant === 'default' && 'bg-primary text-primary-foreground hover:bg-slate-800',
      variant === 'outline' && 'border border-slate-300 bg-white hover:bg-slate-50',
      variant === 'ghost' && 'hover:bg-slate-100',
      variant === 'secondary' && 'bg-slate-100 hover:bg-slate-200',
      variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-red-600',
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 disabled:bg-slate-100',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, children, htmlFor }: { className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1 block text-sm font-medium text-slate-700', className)}>
      {children}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-white shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-slate-900', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

const badgeTones: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-indigo-100 text-indigo-800',
  READY_FOR_DISPATCH: 'bg-violet-100 text-violet-800',
  SHIPPED: 'bg-cyan-100 text-cyan-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-800',
  RETURNED: 'bg-orange-100 text-orange-800',
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  PARTIALLY_RECEIVED: 'bg-cyan-100 text-cyan-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  INACTIVE: 'bg-slate-100 text-slate-600',
  PAID: 'bg-emerald-100 text-emerald-800',
  REFUNDED: 'bg-orange-100 text-orange-800',
  REQUESTED: 'bg-amber-100 text-amber-800',
  LOW: 'bg-red-100 text-red-800',
};

export function Badge({ status, children, className }: { status?: string; children?: ReactNode; className?: string }) {
  const label = children ?? status?.replaceAll('_', ' ').toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        (status && badgeTones[status]) || 'bg-slate-100 text-slate-700',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border bg-white', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b px-4 py-3 align-middle', className)} {...props} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white px-6 py-14 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} />;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className={cn('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 py-3 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      {retry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
