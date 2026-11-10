import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { Field } from './ui';

export interface ComboOption {
  value: string;
  label?: string;
  description?: string;
}

/**
 * Dropdown with search. Clicking the field (or the arrow) opens the list; typing filters it.
 * With `allowCustom` (default) a value that is not in the list can still be typed, because FBR
 * lists can be unavailable or incomplete; without it, only listed values can be chosen.
 * `onQuery` switches to server-side search (the parent supplies matching options).
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  required,
  error,
  hint,
  placeholder,
  loading,
  disabled,
  allowCustom = true,
  onQuery,
  source,
  emptyText = 'No matches',
  className,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string, option?: ComboOption) => void;
  options: ComboOption[];
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
  onQuery?: (q: string) => void;
  /** Shown at the top of the list, e.g. "Official list from FBR". */
  source?: string;
  emptyText?: string;
  className?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
}) {
  const id = useId();
  const listId = `${id}-list`;
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not typing; show all options
  const [active, setActive] = useState(0);

  const shown = useMemo(() => {
    if (onQuery || query === null || query.trim() === '') return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => `${o.value} ${o.label ?? ''} ${o.description ?? ''}`.toLowerCase().includes(q));
  }, [options, query, onQuery]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  function close() {
    setOpen(false);
    if (!allowCustom && query !== null && !options.some((o) => o.value === value)) onChange('');
    setQuery(null);
  }
  function pick(o: ComboOption) {
    onChange(o.value, o);
    setQuery(null);
    setOpen(false);
    input.current?.focus();
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation(); // keep a surrounding dialog open
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  }

  const selected = options.find((o) => o.value === value);
  return (
    <Field label={label} required={required} error={error} hint={hint} className={className} htmlFor={id}>
      <div ref={wrap} className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-o${active}` : undefined}
          autoComplete="off"
          inputMode={inputMode}
          disabled={disabled}
          placeholder={placeholder}
          className={clsx('input pr-9', error && 'input-error')}
          value={query ?? value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setOpen(true);
            onQuery?.(v);
            if (allowCustom) onChange(v);
          }}
          onKeyDown={onKey}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label} options`}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-400 hover:text-ink-700"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) close();
            else {
              setOpen(true);
              input.current?.focus();
            }
          }}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ChevronDown className={clsx('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden />}
        </button>
        {open && !disabled && (
          <div className="animate-pop absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg shadow-ink-900/10">
            {source && <p className="border-b border-ink-100 bg-ink-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">{source}</p>}
            <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
              {loading && shown.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">Loading…</li>}
              {!loading && shown.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">{allowCustom && (query ?? '').trim() ? `Use “${query}” as typed` : emptyText}</li>}
              {shown.map((o, i) => (
                <li
                  key={`${o.value}-${i}`}
                  id={`${id}-o${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={clsx('flex cursor-pointer items-start gap-2 px-3 py-2 text-sm', i === active ? 'bg-brand-50 text-brand-900' : 'text-ink-800')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                >
                  <Check className={clsx('mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.label ?? o.value}</span>
                    {o.description && <span className="block truncate text-xs text-ink-500">{o.description}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!open && selected?.description && <span className="sr-only">{selected.description}</span>}
    </Field>
  );
}
