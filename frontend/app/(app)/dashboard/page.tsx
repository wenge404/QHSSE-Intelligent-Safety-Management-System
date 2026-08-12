'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { formatNumber, humanise } from '@/lib/format';
import {
  Card,
  ErrorNote,
  MiniStat,
  PageHeader,
  Spinner,
  Stat,
  TableWrap,
} from '@/components/ui';

interface Kpi {
  value: number | null;
  unit: string;
  label: string;
  formula: string;
  note: string | null;
  numerator?: number;
  denominator?: number;
  sampleSize?: number;
  nearMisses?: number;
  personHours?: number;
}

interface KpiResponse {
  period: { from: string; to: string };
  scope: string;
  kpis: { cacr: Kpi; mttc: Kpi; nmfr: Kpi };
  counts: {
    totalIncidents: number;
    nearMisses: number;
    actualIncidents: number;
    totalActions: number;
    verifiedActions: number;
    overdueActions: number;
    auditsTotal: number;
    auditsCompleted: number;
    auditCompletionRate: number | null;
  };
  breakdowns: {
    byStatus: { key: string; count: number }[];
    byCause: { key: string; count: number }[];
    byPredictedRisk: { key: string; count: number }[];
    byZone: { key: string; count: number }[];
    monthly: { month: string; incidents: number; nearMisses: number }[];
  };
}

const RISK_COLOURS: Record<string, string> = {
  LOW: '#10b981',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
  UNSCORED: '#cbd5e1',
};

export default function DashboardPage() {
  const [data, setData] = useState<KpiResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // Sweep elapsed due dates first so the overdue figure is honest, then read
    // the KPIs. Both are cheap; neither is cached.
    api('/api/v1/corrective-actions/refresh-overdue', { method: 'POST' })
      .catch(() => null)
      .then(() => api<KpiResponse>('/api/v1/kpis'))
      .then(setData)
      .catch(setError);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Computing KPIs…" />;

  const { kpis, counts, breakdowns } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: 'Overview' }, { label: 'Dashboard' }]}
        title="QHSSE dashboard"
        subtitle={`${data.scope} · last 12 months · computed live from the incident, audit and corrective action tables`}
      />

      {/* The three KPIs the proposal commits to in §11. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Corrective action closure rate"
          value={kpis.cacr.value === null ? '—' : formatNumber(kpis.cacr.value)}
          unit="%"
          detail={`${kpis.cacr.numerator} of ${kpis.cacr.denominator} raised actions verified`}
          note={kpis.cacr.note}
          accent={
            kpis.cacr.value === null ? 'brand' : kpis.cacr.value >= 75 ? 'emerald' : kpis.cacr.value >= 50 ? 'amber' : 'red'
          }
        />
        <Stat
          label="Mean time to close"
          value={kpis.mttc.value === null ? '—' : formatNumber(kpis.mttc.value)}
          unit="days"
          detail={`across ${kpis.mttc.sampleSize} closed actions`}
          note={kpis.mttc.note}
          accent="brand"
        />
        <Stat
          label="Near-miss frequency rate"
          value={kpis.nmfr.value === null ? '—' : formatNumber(kpis.nmfr.value, 2)}
          unit="per 200k h"
          detail={`${kpis.nmfr.nearMisses} near-misses / ${formatNumber(kpis.nmfr.personHours ?? 0, 0)} person-hours`}
          note={kpis.nmfr.note}
          accent="brand"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Incidents" value={counts.actualIncidents} />
        <MiniStat label="Near-misses" value={counts.nearMisses} />
        <MiniStat label="Overdue actions" value={counts.overdueActions} tone="danger" />
        <MiniStat
          label="Audits completed"
          value={`${counts.auditsCompleted}/${counts.auditsTotal}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Incidents and near-misses by month">
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={breakdowns.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="incidents"
                  name="Incidents"
                  stroke="#2E5395"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="nearMisses"
                  name="Near-misses"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Workflow state distribution">
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={breakdowns.byStatus.map((r) => ({ ...r, name: humanise(r.key) }))}
                layout="vertical"
                margin={{ left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <Tooltip />
                <Bar dataKey="count" name="Incidents" fill="#2E5395" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Apparent cause — PHMSA 8-category taxonomy">
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={breakdowns.byCause
                  .map((r) => ({ ...r, name: humanise(r.key) }))
                  .sort((a, b) => b.count - a.count)}
                layout="vertical"
                margin={{ left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <Tooltip />
                <Bar dataKey="count" name="Incidents" fill="#5081cb" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Predicted risk band (model set B)">
          <div className="px-3 py-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={breakdowns.byPredictedRisk.map((r) => ({ ...r, name: humanise(r.key) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" name="Incidents" radius={[3, 3, 0, 0]}>
                  {breakdowns.byPredictedRisk.map((entry) => (
                    <Cell key={entry.key} fill={RISK_COLOURS[entry.key] ?? '#94a3b8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="px-2 pt-2 text-xs text-slate-400">
              Bands are cut relative to the 0.68 training base rate, not an abstract quartile grid.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Incidents by zone">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="w-28 text-right">Incidents</th>
                <th className="w-1/2">Share</th>
              </tr>
            </thead>
            <tbody>
              {breakdowns.byZone.map((row) => {
                const max = Math.max(...breakdowns.byZone.map((z) => z.count), 1);
                return (
                  <tr key={row.key}>
                    <td className="font-medium text-slate-700">{row.key}</td>
                    <td className="text-right tabular-nums">{row.count}</td>
                    <td>
                      <div className="h-1.5 w-full rounded-full bg-slate-100">
                        <div
                          className="h-1.5 rounded-full bg-brand-400"
                          style={{ width: `${(row.count / max) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="How these numbers are calculated">
        <dl className="divide-y divide-slate-100">
          {[kpis.cacr, kpis.mttc, kpis.nmfr].map((kpi) => (
            <div key={kpi.label} className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5">
              <dt className="w-56 shrink-0 text-[13px] font-medium text-slate-700">{kpi.label}</dt>
              <dd className="mono text-slate-500">{kpi.formula}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
