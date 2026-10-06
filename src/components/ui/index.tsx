// Small, consistent UI kit. Flat surfaces, 1px borders, no glassmorphism.
import { Loader2, RotateCw, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { trustTone } from '@/lib/engine/trust';
import type { Severity } from '@/lib/types';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-yellow text-navy hover:bg-[#ffdf6b] font-semibold',
  secondary: 'bg-purple text-white hover:bg-[#7f77ff] font-semibold',
  outline: 'border border-line-2 text-ink hover:border-muted hover:bg-white/[0.03]',
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.05]',
  danger: 'border border-anomaly/50 text-anomaly hover:bg-anomaly/10',
};

export function Button({ variant = 'outline', size = 'md', loading, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-[15px] gap-2' };
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50', sizes[size], VARIANTS[variant], className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

export const SEVERITY_STYLE: Record<Severity | 'info', string> = {
  high: 'bg-anomaly/15 text-[#ff8a95] ring-anomaly/30',
  medium: 'bg-missing/15 text-[#ffb877] ring-missing/30',
  low: 'bg-obligation/15 text-[#86c3ff] ring-obligation/30',
  info: 'bg-white/5 text-muted ring-white/10',
};

export function SeverityBadge({ severity }: { severity: Severity | 'info' }) {
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wider uppercase ring-1 ring-inset', SEVERITY_STYLE[severity])}>{severity}</span>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-xs text-muted ring-1 ring-white/10 ring-inset', className)}>{children}</span>;
}

/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-line-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <div className="max-w-md text-sm text-muted">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: Error | string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-[10px] border border-anomaly/40 bg-anomaly/10 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4 text-anomaly" /> {title}
      </p>
      <p className="text-sm break-words text-muted">{typeof error === 'string' ? error : error.message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw className="size-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className={cx('card flex max-h-[92vh] w-full animate-rise flex-col outline-none sm:max-h-[85vh]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={id} className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-faint hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ id: T; label: string; count?: number; tone?: string }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors', value === t.id ? 'border-yellow text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.tone && <span className="size-1.5 rounded-full" style={{ background: t.tone }} />}
          {t.label}
          {t.count != null && <span className="rounded bg-white/5 px-1.5 text-xs text-faint tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const TONE_COLOR = { good: '#3ecf8e', fair: '#ffd43b', poor: '#ff5d6c', none: '#6f7a96' } as const;

export function TrustRing({ score, size = 56, stroke = 5, label = true }: { score: number | null | undefined; size?: number; stroke?: number; label?: boolean }) {
  const tone = trustTone(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} title={score == null ? 'Not scored yet' : `Trust score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      {label && (
        <span className="absolute font-semibold tabular-nums" style={{ fontSize: size * 0.3, color: TONE_COLOR[tone] }}>
          {score ?? '–'}
        </span>
      )}
      <span className="sr-only">Trust score {score ?? 'not available'} out of 100</span>
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct >= 90 ? 'bg-amount' : pct >= 75 ? 'bg-yellow' : 'bg-anomaly';
  return (
    <div className="flex items-center gap-2" title={`Confidence ${pct}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Confidence">
        <div className={cx('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="cite text-faint tabular-nums">{pct}%</span>
    </div>
  );
}

export function Cite({ page, line, onClick, prefix, className }: { page: number | null | undefined; line: number | null | undefined; onClick?: () => void; prefix?: string; className?: string }) {
  if (!page) return <span className={cx('cite text-faint', className)}>↳ {prefix ?? 'no line'}</span>;
  const text = `↳ ${prefix ? `${prefix} · ` : ''}p.${page}${line ? ` · L${line}` : ''}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={cx('cite rounded px-1 -mx-1 text-yellow/90 hover:bg-yellow/10 hover:text-yellow', className)} title="Show in document">
      {text}
    </button>
  ) : (
    <span className={cx('cite text-yellow/90', className)}>{text}</span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} aria-label="Loading" />;
}
