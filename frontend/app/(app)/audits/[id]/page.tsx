'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, humanise } from '@/lib/format';
import { useEnums } from '@/lib/useEnums';
import { Badge, Card, ErrorNote, PageHeader, Spinner, TableWrap } from '@/components/ui';

const COMPLIANCE = ['COMPLIANT', 'NON_COMPLIANT', 'OBSERVATION', 'NOT_APPLICABLE'];

export default function AuditDetailPage({ params }: { params: { id: string } }) {
  const { workflow } = useEnums();
  const [audit, setAudit] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, { status: string; notes: string }>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/v1/audits/${params.id}`);
      setAudit(data);
      const existing: Record<number, { status: string; notes: string }> = {};
      for (const response of data.responses ?? []) {
        existing[response.checklistItemId] = {
          status: response.complianceStatus,
          notes: response.notes ?? '',
        };
      }
      setAnswers(existing);
    } catch (err) {
      setError(err);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveResponses() {
    setBusy(true);
    setError(null);
    try {
      const responses = Object.entries(answers)
        .filter(([, value]) => value.status)
        .map(([itemId, value]) => ({
          checklistItemId: Number(itemId),
          complianceStatus: value.status,
          notes: value.notes || null,
        }));
      if (responses.length === 0) {
        throw new Error('Answer at least one checklist item before saving.');
      }
      await api(`/api/v1/audits/${params.id}/responses`, {
        method: 'POST',
        body: JSON.stringify({ responses }),
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function transition(status: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/audits/${params.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error && !audit) return <ErrorNote error={error} />;
  if (!audit) return <Spinner />;

  const items = audit.template.items ?? [];
  const answered = Object.values(answers).filter((a) => a.status).length;
  const editable = audit.status === 'PLANNED' || audit.status === 'IN_PROGRESS';
  const nextStates: string[] = workflow?.audit.transitions[audit.status] ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[
          { label: 'Operations' },
          { label: 'Audits', href: '/audits' },
          { label: audit.referenceNumber },
        ]}
        title={audit.template.name}
        subtitle={`${audit.zone?.name ?? 'No zone'} · scheduled ${formatDate(audit.scheduledDate)} · ${audit.conductedBy.fullName}`}
        meta={
          <>
            <Badge value={audit.status} />
            {audit.template.isoClause && (
              <span className="pill border-slate-200 bg-slate-50 font-mono text-slate-500">
                {audit.template.isoClause}
              </span>
            )}
          </>
        }
        actions={
          <Link href="/audits" className="btn-secondary">
            Back to list
          </Link>
        }
      />

      <ErrorNote error={error} />

      <Card title={`Checklist — ${answered} of ${items.length} answered`}>
        <div className="divide-y divide-slate-100">
          {items.map((item: any, index: number) => {
            const answer = answers[item.id] ?? { status: '', notes: '' };
            return (
              <div key={item.id} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-6 shrink-0 text-xs text-slate-400">{index + 1}.</span>
                  <div className="flex-1">
                    <p className="text-sm text-slate-800">{item.itemText}</p>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {COMPLIANCE.map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={!editable}
                          onClick={() =>
                            setAnswers((prev) => ({
                              ...prev,
                              [item.id]: { ...answer, status },
                            }))
                          }
                          className={`rounded border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed ${
                            answer.status === status
                              ? statusActive(status)
                              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {humanise(status)}
                        </button>
                      ))}
                    </div>

                    {answer.status === 'NON_COMPLIANT' && (
                      <input
                        className="input mt-2 text-sm"
                        placeholder="Finding detail — becomes the corrective action context"
                        value={answer.notes}
                        disabled={!editable}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [item.id]: { ...answer, notes: e.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="text-[11.5px] text-slate-500">
              An audit cannot be completed until every item is answered — these records back an ISO
              9001 §9.2 claim.
            </p>
            <button className="btn-primary" onClick={saveResponses} disabled={busy}>
              Save answers
            </button>
          </div>
        )}
      </Card>

      {nextStates.length > 0 && (
        <Card title="Workflow">
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {nextStates.map((state) => (
              <button
                key={state}
                className={state === 'CANCELLED' ? 'btn-danger' : 'btn-primary'}
                disabled={busy}
                onClick={() => transition(state)}
              >
                Mark {humanise(state)}
              </button>
            ))}
          </div>
        </Card>
      )}

      {audit.responses?.some((r: any) => r.correctiveActions?.length) && (
        <Card title="Corrective actions raised from this audit">
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Finding</th>
                <th>Assigned to</th>
                <th>Due</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {audit.responses.flatMap((response: any) =>
                (response.correctiveActions ?? []).map((action: any) => (
                  <tr key={action.id}>
                    <td className="mono whitespace-nowrap text-slate-500">
                      {action.referenceNumber}
                    </td>
                    <td className="max-w-md text-slate-700">{action.description}</td>
                    <td className="whitespace-nowrap text-slate-600">
                      {action.assignedTo?.fullName}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDate(action.dueDate)}</td>
                    <td>
                      <Badge value={action.status} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          </TableWrap>
        </Card>
      )}

      <Card title="Audit trail">
        {audit.history?.length ? (
          <ol className="divide-y divide-slate-100">
            {audit.history.map((entry: any) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[11.5px]">
                <span className="font-medium text-slate-700">{humanise(entry.action)}</span>
                {entry.previousState && (
                  <span className="text-slate-500">
                    {humanise(entry.previousState)} → {humanise(entry.newState)}
                  </span>
                )}
                <span className="ml-auto text-slate-400">
                  {entry.user?.fullName ?? 'System'} · {formatDateTime(entry.timestamp)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-slate-400">No trail entries.</p>
        )}
      </Card>
    </div>
  );
}

function statusActive(status: string): string {
  switch (status) {
    case 'COMPLIANT':
      return 'border-emerald-300 bg-emerald-50 font-medium text-emerald-700';
    case 'NON_COMPLIANT':
      return 'border-red-300 bg-red-50 font-medium text-red-700';
    case 'OBSERVATION':
      return 'border-amber-300 bg-amber-50 font-medium text-amber-800';
    default:
      return 'border-slate-300 bg-slate-100 font-medium text-slate-600';
  }
}
