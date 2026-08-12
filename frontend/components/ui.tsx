'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { humanise, statusClass } from '@/lib/format';
import { IconChevronRight } from './icons';

export function Badge({ value, label }: { value: string | null | undefined; label?: string }) {
  return <span className={`pill ${statusClass(value)}`}>{label ?? humanise(value)}</span>;
}

/** Consistent page banner: breadcrumb, title, supporting line, and actions. */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  meta,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-1.5 flex items-center gap-1 text-[11.5px] text-slate-400">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <IconChevronRight className="h-3 w-3" />}
              {crumb.href ? (
                <Link href={crumb.href} className="transition hover:text-brand-600">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-slate-500">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = '',
  footer,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="card-header">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      {children}
      {footer && (
        <footer className="border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-[12px] text-slate-500">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Wraps a table so wide content scrolls inside the card, never the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{hint}</p>}
    </div>
  );
}

export function Empty({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="text-[13px] text-slate-400">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-4 py-14 text-[13px] text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-2.5 rounded border-l-[3px] border-l-red-500 border-y border-r border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
      <span className="mt-[1px] font-semibold">!</span>
      <span>{message}</span>
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border-l-[3px] border-l-brand-400 border-y border-r border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] leading-relaxed text-slate-600">
      {children}
    </div>
  );
}

/** Headline KPI tile — large figure, formula, and the working behind it. */
export function Stat({
  label,
  value,
  unit,
  detail,
  note,
  accent = 'brand',
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  note?: string | null;
  accent?: 'brand' | 'emerald' | 'amber' | 'red';
}) {
  const accents: Record<string, string> = {
    brand: 'before:bg-brand-500',
    emerald: 'before:bg-emerald-500',
    amber: 'before:bg-amber-500',
    red: 'before:bg-red-500',
  };
  return (
    <div
      className={`card relative overflow-hidden px-4 py-3.5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accents[accent]}`}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold leading-none tabular-nums text-slate-900">
          {value}
        </span>
        {unit && <span className="text-[12px] text-slate-400">{unit}</span>}
      </p>
      {detail && <p className="mt-1.5 text-[11.5px] text-slate-500">{detail}</p>}
      {note && <p className="mt-1.5 text-[11.5px] text-amber-700">{note}</p>}
    </div>
  );
}

/** Compact counter used in the secondary tile row. */
export function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'danger';
}) {
  const danger = tone === 'danger' && Number(value) > 0;
  return (
    <div className="card flex items-center justify-between px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
        {label}
      </span>
      <span
        className={`text-[19px] font-semibold tabular-nums ${danger ? 'text-red-600' : 'text-slate-900'}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Label/value pair used on record detail screens. */
export function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-0.5 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] transition ${
            active === tab.key
              ? 'border-brand-500 font-semibold text-brand-700'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
