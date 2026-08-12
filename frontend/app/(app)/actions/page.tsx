'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { formatDate, humanise } from '@/lib/format';
import { useEnums } from '@/lib/useEnums';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, TableWrap } from '@/components/ui';

export default function ActionsPage() {
  const { workflow } = useEnums();
  const [actions, setActions] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const me = typeof window !== 'undefined' ? getStoredUser() : null;

  const load = useCallback(async () => {
    setActions(null);
    try {
      const data = await api(`/api/v1/corrective-actions${mineOnly ? '?mine=true' : ''}`);
      setActions(data.data);
    } catch (err) {
      setError(err);
    }
  }, [mineOnly]);

  useEffect(() => {
    api('/api/v1/corrective-actions/refresh-overdue', { method: 'POST' })
      .catch(() => null)
      .then(load);
  }, [load]);

  async function transition(id: number, status: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/v1/corrective-actions/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Corrective actions' }]}
        title="Corrective actions"
        subtitle="Raised from incident investigations and audit non-conformities"
        actions={
          <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-[7px] text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
            />
            Assigned to me
          </label>
        }
      />

      <ErrorNote error={error} />

      <Card>
        {!actions ? (
          <Spinner />
        ) : actions.length === 0 ? (
          <Empty message="No corrective actions in scope." />
        ) : (
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Description</th>
                <th>Source</th>
                <th>Assigned to</th>
                <th>Raised</th>
                <th>Due</th>
                <th>State</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => {
                const next: string[] =
                  workflow?.correctiveAction.transitions[action.status] ?? [];
                const overdue = action.status === 'OVERDUE';
                return (
                  <tr key={action.id} className={overdue ? 'bg-red-50/40' : undefined}>
                    <td className="mono whitespace-nowrap text-slate-500">
                      {action.referenceNumber}
                    </td>
                    <td className="max-w-sm text-slate-700">{action.description}</td>
                    <td className="whitespace-nowrap text-xs">
                      {action.incident ? (
                        <Link
                          href={`/incidents/${action.incident.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {action.incident.referenceNumber}
                        </Link>
                      ) : action.auditResponse ? (
                        <Link
                          href={`/audits/${action.auditResponse.audit.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {action.auditResponse.audit.referenceNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                      <span className="ml-1.5 text-slate-400">{humanise(action.source)}</span>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {action.assignedTo?.fullName}
                      {me?.id === action.assignedTo?.id && (
                        <span className="ml-1 text-xs text-brand-600">(you)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDate(action.raisedAt)}</td>
                    <td
                      className={`whitespace-nowrap ${overdue ? 'font-medium text-red-600' : 'text-slate-600'}`}
                    >
                      {formatDate(action.dueDate)}
                    </td>
                    <td>
                      <Badge value={action.status} />
                    </td>
                    <td>
                      {next.length === 0 ? (
                        <span className="text-xs text-slate-400">Closed</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {next.map((state) => (
                            <button
                              key={state}
                              disabled={busy === action.id}
                              onClick={() => transition(action.id, state)}
                              className="btn-secondary btn-xs"
                            >
                              {humanise(state)}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TableWrap>
        )}
      </Card>

      <p className="text-[11.5px] text-slate-400">
        Verification is restricted by role: a QHSSE Auditor may only verify audit-sourced actions,
        and nobody may sign off an action assigned to themselves.
      </p>
    </div>
  );
}
