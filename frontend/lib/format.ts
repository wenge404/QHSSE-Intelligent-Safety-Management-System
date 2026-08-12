/** Presentation helpers shared across pages. */

/** SCREAMING_SNAKE_CASE → "Screaming snake case". */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  UNDER_INVESTIGATION: 'bg-amber-50 text-amber-800 border-amber-200',
  CORRECTIVE_ACTION_PENDING: 'bg-orange-50 text-orange-800 border-orange-200',
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-slate-800 text-white border-slate-800',

  PLANNED: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',

  OPEN: 'bg-slate-100 text-slate-700 border-slate-200',
  OVERDUE: 'bg-red-50 text-red-700 border-red-200',

  COMPLIANT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NON_COMPLIANT: 'bg-red-50 text-red-700 border-red-200',
  OBSERVATION: 'bg-amber-50 text-amber-800 border-amber-200',
  NOT_APPLICABLE: 'bg-slate-100 text-slate-500 border-slate-200',

  LOW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-200',
  HIGH: 'bg-orange-50 text-orange-800 border-orange-200',
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',

  NEAR_MISS: 'bg-sky-50 text-sky-700 border-sky-200',
  INCIDENT: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function statusClass(status: string | null | undefined): string {
  return STATUS_STYLES[status ?? ''] ?? 'bg-slate-100 text-slate-600 border-slate-200';
}

export const ROLE_LABELS: Record<string, string> = {
  FIELD_REPORTER: 'Field Reporter',
  QHSSE_AUDITOR: 'QHSSE Auditor',
  DEPARTMENT_LEAD: 'Department Lead',
  SYSTEM_ADMIN: 'System Admin',
};
