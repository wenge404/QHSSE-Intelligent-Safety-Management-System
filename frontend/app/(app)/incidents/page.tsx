'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, humanise } from '@/lib/format';
import { optionsOf, useEnums } from '@/lib/useEnums';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, TableWrap } from '@/components/ui';
import { IconPlus, IconSearch } from '@/components/icons';

interface IncidentRow {
  id: number;
  referenceNumber: string;
  type: string;
  title: string;
  occurredAt: string;
  status: string;
  severity: string;
  causeCategory: string | null;
  predictedRiskLevel: string | null;
  predictedRiskScore: number | null;
  reportedBy: { id: number; fullName: string };
  zone: { id: number; name: string } | null;
  _count: { correctiveActions: number };
}

export default function IncidentsPage() {
  const { enums } = useEnums();
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);

  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setRows(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (search.trim()) params.set('search', search.trim());
    try {
      const data = await api(`/api/v1/incidents?${params}`);
      setRows(data.data);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err);
    }
  }, [page, status, type, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Incidents' }]}
        title="Incidents &amp; near-misses"
        subtitle={`${total} record${total === 1 ? '' : 's'} within your access scope`}
        actions={
          <Link href="/incidents/new" className="btn-primary">
            <IconPlus className="h-4 w-4" />
            Report an incident
          </Link>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-2.5 px-4 py-3">
          <div className="relative max-w-xs flex-1">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8"
              placeholder="Search title, description or reference…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
          <select
            className="input w-auto"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All states</option>
            {optionsOf(enums, 'IncidentStatus').map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
          <select
            className="input w-auto"
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
          >
            <option value="">All types</option>
            {optionsOf(enums, 'IncidentType').map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <ErrorNote error={error} />

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty message="No incidents match these filters." />
        ) : (
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Title</th>
                <th>Occurred</th>
                <th>Zone</th>
                <th>Cause</th>
                <th>State</th>
                <th>Predicted risk</th>
                <th className="text-right">CAs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono whitespace-nowrap text-slate-500">
                    <Link href={`/incidents/${row.id}`} className="hover:text-brand-600">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="max-w-sm">
                    <Link
                      href={`/incidents/${row.id}`}
                      className="font-medium text-slate-800 hover:text-brand-600"
                    >
                      {row.title}
                    </Link>
                    <div className="mt-1 flex gap-1.5">
                      <Badge value={row.type} />
                      <Badge value={row.severity} label={`Severity: ${humanise(row.severity)}`} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-slate-600">{formatDate(row.occurredAt)}</td>
                  <td className="text-slate-600">{row.zone?.name ?? '—'}</td>
                  <td className="text-slate-600">{humanise(row.causeCategory)}</td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="whitespace-nowrap">
                    {row.predictedRiskLevel ? (
                      <span className="flex items-center gap-2">
                        <Badge value={row.predictedRiskLevel} />
                        <span className="mono text-slate-400">
                          {row.predictedRiskScore?.toFixed(2)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-slate-400">Unscored</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-slate-600">
                    {row._count.correctiveActions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        )}

        {rows && total > 20 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-[12.5px]">
            <button
              className="btn-secondary btn-xs"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="text-slate-500">
              Page {page} of {Math.ceil(total / 20)}
            </span>
            <button
              className="btn-secondary btn-xs"
              disabled={page >= Math.ceil(total / 20)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
