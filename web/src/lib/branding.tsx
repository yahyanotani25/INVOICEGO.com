import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Branding {
  softwareName: string;
  companyName: string | null;
  companyAddress: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  logoText: string | null;
  logoUrl: string | null;
}

const FALLBACK: Branding = { softwareName: 'InvoiceGO', companyName: null, companyAddress: null, supportEmail: null, supportPhone: null, logoText: null, logoUrl: null };

/** Platform name, support contact and logo, managed by administrators in Admin → Settings. */
export function useBranding(): Branding {
  const q = useQuery({ queryKey: ['branding'], queryFn: () => api<Branding>('/api/public/branding'), staleTime: 5 * 60_000, retry: 1 });
  return q.data ?? FALLBACK;
}

/** Logo (uploaded by an administrator) or the default mark, with the platform name. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const b = useBranding();
  const h = size === 'lg' ? 'h-8' : 'h-7';
  return (
    <span className="flex min-w-0 items-center gap-2">
      {b.logoUrl ? <img src={b.logoUrl} alt="" className={`${h} w-auto max-w-[9rem] object-contain`} /> : <img src="/favicon.svg" alt="" className={`${h} w-auto`} />}
      <span className={`truncate font-semibold tracking-tight text-ink-900 ${size === 'lg' ? 'text-lg' : 'text-lg'}`}>{b.logoText || b.softwareName}</span>
    </span>
  );
}
