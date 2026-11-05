import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X, XCircle } from 'lucide-react';
import type { Tone } from '@/lib/format';
import { ApiError, type Issue } from '@/lib/api';

// ------------------------------------------------------------------ buttons
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
        variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
        variant === 'secondary' && 'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 shadow-sm',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
        variant === 'ghost' && 'text-ink-600 hover:bg-ink-100',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ form fields
export function Field({ label, required, error, hint, children, className, htmlFor }: { label: string; required?: boolean; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={clsx('space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ label, required, error, hint, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className} htmlFor={id}>
      <input id={id} required={required} aria-invalid={!!error} {...p} className={clsx('input', error && 'input-error')} />
    </Field>
  );
}

export function SelectInput({ label, required, error, hint, className, options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | null; hint?: ReactNode; options: (string | { value: string; label: string })[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className} htmlFor={id}>
      <select id={id} required={required} aria-invalid={!!error} {...p} className={clsx('input', error && 'input-error')}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function TextArea({ label, required, error, hint, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | null; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className} htmlFor={id}>
      <textarea id={id} required={required} aria-invalid={!!error} {...p} className={clsx('input', error && 'input-error')} />
    </Field>
  );
}

/** Text input with a datalist of suggestions (free text still allowed). */
export function ComboInput({ label, required, error, hint, className, suggestions, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode; suggestions: string[] }) {
  const id = useId();
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className} htmlFor={id}>
      <input id={id} list={`${id}-l`} required={required} aria-invalid={!!error} {...p} className={clsx('input', error && 'input-error')} />
      <datalist id={`${id}-l`}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300" />
      <label htmlFor={id} className="text-sm text-ink-700">
        {label}
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ display
export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          {typeof title === 'string' ? <h2 className="text-sm font-semibold text-ink-900">{title}</h2> : title}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

const toneCls: Record<Tone, string> = {
  gray: 'bg-ink-100 text-ink-700 ring-ink-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-brand-50 text-brand-700 ring-brand-200',
};
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneCls[tone], className)}>{children}</span>;
}

export function EnvBadge({ env }: { env: 'SANDBOX' | 'PRODUCTION' | string }) {
  return env === 'PRODUCTION' ? (
    <Badge tone="green" className="font-semibold">
      ● PRODUCTION
    </Badge>
  ) : (
    <Badge tone="amber" className="font-semibold">
      ● SANDBOX
    </Badge>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-500">{children}</div>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'blue', title, children, className }: { tone?: 'blue' | 'red' | 'amber' | 'green'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = tone === 'red' ? XCircle : tone === 'amber' ? AlertTriangle : tone === 'green' ? CheckCircle2 : Info;
  const cls = { blue: 'border-sky-200 bg-sky-50 text-sky-900', red: 'border-red-200 bg-red-50 text-red-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', green: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[tone];
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={clsx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-[13px] leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <Alert tone="red" title={e.message ?? 'Something went wrong'}>
      {e instanceof ApiError && e.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {e.issues.slice(0, 12).map((i, k) => (
            <li key={k}>
              {i.line ? `Item ${i.line}: ` : ''}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function issueFor(issues: Issue[] | undefined, field: string, line?: number) {
  return issues?.find((i) => i.field === field && (line === undefined ? !i.line : i.line === line) && i.level === 'error')?.message ?? null;
}

// ------------------------------------------------------------------ table + pagination
export function Table({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-ink-100">
        <thead className="bg-ink-50">{head}</thead>
        <tbody className="divide-y divide-ink-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}

export function SortTh({ label, field, sort, dir, onSort, className }: { label: string; field: string; sort?: string; dir?: 'asc' | 'desc'; onSort: (f: string) => void; className?: string }) {
  const active = sort === field;
  return (
    <th className={clsx('table-th', className)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 uppercase hover:text-ink-800">
        {label}
        <span aria-hidden className="text-[10px]">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-ink-100 px-3 py-2 text-xs text-ink-500">
      <span>
        {total.toLocaleString()} record{total === 1 ? '' : 's'} · page {page} of {pages}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ dialog
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold text-ink-900">
            {title}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-ink-500 hover:bg-ink-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, loading, children }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; loading?: boolean; children?: ReactNode }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-700">{message}</div>
      {children}
    </Dialog>
  );
}

// ------------------------------------------------------------------ toasts
type ToastT = { id: number; tone: 'green' | 'red' | 'blue' | 'amber'; text: string };
const ToastCtx = createContext<(tone: ToastT['tone'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((tone: ToastT['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <Alert key={t.id} tone={t.tone} className="shadow-lg">
            {t.text}
          </Alert>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'green' && 'text-emerald-700', tone === 'red' && 'text-red-700', tone === 'amber' && 'text-amber-700', !tone && 'text-ink-900')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)} className={clsx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', active === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Minimal accessible bar chart (no third-party chart library). */
export function BarChart({ data, format = (v: number) => v.toLocaleString() }: { data: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <EmptyState title="No data for this period" />;
  return (
    <div className="space-y-1.5" role="list">
      {data.map((d) => (
        <div key={d.label} role="listitem" className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-ink-500">{d.label}</span>
          <div className="h-3 rounded bg-ink-100">
            <div className="h-3 rounded bg-brand-500" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="tabular-nums text-ink-700">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
