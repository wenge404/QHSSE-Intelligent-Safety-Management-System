'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { formatDate, formatDateTime, humanise } from '@/lib/format';
import { useEnums } from '@/lib/useEnums';
import {
  Badge,
  Card,
  Detail,
  Empty,
  ErrorNote,
  Field,
  InfoNote,
  PageHeader,
  Spinner,
  TableWrap,
} from '@/components/ui';
import { IconRefresh } from '@/components/icons';

export default function IncidentDetailPage({ params }: { params: { id: string } }) {
  const { workflow } = useEnums();
  const [incident, setIncident] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<{ id: number; fullName: string }[]>([]);
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState({ description: '', assignedToId: '', dueDate: '' });

  const me = typeof window !== 'undefined' ? getStoredUser() : null;

  const load = useCallback(async () => {
    try {
      setIncident(await api(`/api/v1/incidents/${params.id}`));
    } catch (err) {
      setError(err);
    }
  }, [params.id]);

  useEffect(() => {
    load();
    api('/api/v1/admin/users')
      .then((d) => setUsers(d.data))
      .catch(() => setUsers([]));
  }, [load]);

  async function transition(status: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/incidents/${params.id}/transition`, {
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

  async function rescore() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/incidents/${params.id}/score`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function raiseAction(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/corrective-actions', {
        method: 'POST',
        body: JSON.stringify({
          description: actionForm.description,
          source: 'INCIDENT',
          incidentId: Number(params.id),
          assignedToId: Number(actionForm.assignedToId),
          dueDate: new Date(actionForm.dueDate).toISOString(),
        }),
      });
      setShowActionForm(false);
      setActionForm({ description: '', assignedToId: '', dueDate: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (error && !incident) return <ErrorNote error={error} />;
  if (!incident) return <Spinner />;

  const nextStates: string[] = workflow?.incident.transitions[incident.status] ?? [];
  const allowedRoles: string[] = workflow?.incident.roles[incident.status] ?? [];
  const canDrive = me ? allowedRoles.includes(me.role) : false;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[
          { label: 'Operations' },
          { label: 'Incidents', href: '/incidents' },
          { label: incident.referenceNumber },
        ]}
        title={incident.title}
        meta={
          <>
            <Badge value={incident.type} />
            <Badge value={incident.status} />
            <Badge value={incident.severity} label={`Severity: ${humanise(incident.severity)}`} />
          </>
        }
        actions={
          <Link href="/incidents" className="btn-secondary">
            Back to list
          </Link>
        }
      />

      <ErrorNote error={error} />

      {/* Workflow control — the state machine made visible. */}
      <Card title="Workflow">
        <div className="px-4 py-4">
          <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            {['DRAFT', 'SUBMITTED', 'UNDER_INVESTIGATION', 'CORRECTIVE_ACTION_PENDING', 'VERIFIED', 'CLOSED'].map(
              (state, index, all) => {
                const currentIndex = all.indexOf(incident.status);
                const done = index < currentIndex;
                const current = state === incident.status;
                return (
                  <li key={state} className="flex items-center gap-1.5">
                    <span
                      className={`rounded border px-2 py-1 ${
                        current
                          ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                          : done
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'
                      }`}
                    >
                      {humanise(state)}
                    </span>
                    {index < all.length - 1 && <span className="text-slate-300">→</span>}
                  </li>
                );
              },
            )}
          </ol>

          {nextStates.length === 0 ? (
            <p className="text-sm text-slate-500">
              This record is closed. No further transitions are permitted.
            </p>
          ) : !canDrive ? (
            <p className="text-sm text-slate-500">
              Your role cannot move a record out of {humanise(incident.status)}. Permitted:{' '}
              {allowedRoles.map((r) => humanise(r)).join(', ')}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {nextStates.map((state) => (
                <button
                  key={state}
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => transition(state)}
                >
                  Move to {humanise(state)}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Description">
            <p className="whitespace-pre-wrap px-4 py-4 text-[13px] leading-relaxed text-slate-700">
              {incident.description}
            </p>
          </Card>

          <Card title="Record detail">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Occurred" value={formatDateTime(incident.occurredAt)} />
              <Detail label="Reported" value={formatDateTime(incident.reportedAt)} />
              <Detail label="Reported by" value={incident.reportedBy?.fullName} />
              <Detail label="Zone" value={incident.zone?.name} />
              <Detail label="Apparent cause" value={humanise(incident.causeCategory)} />
              <Detail label="Component" value={humanise(incident.systemPart)} />
              <Detail label="Location type" value={humanise(incident.locationType)} />
              <Detail
                label="Line pressure"
                value={incident.linePressurePsig ? `${incident.linePressurePsig} PSIG` : '—'}
              />
              <Detail
                label="Nominal diameter"
                value={incident.pipeDiameterInches ? `${incident.pipeDiameterInches} in` : '—'}
              />
              <Detail label="Pipe material" value={humanise(incident.pipeMaterial)} />
              <Detail label="Release type" value={humanise(incident.releaseType)} />
              <Detail label="Incident area" value={humanise(incident.incidentAreaType)} />
              <Detail label="Ignition" value={yesNo(incident.ignitionOccurred)} />
              <Detail label="Explosion" value={yesNo(incident.explosionOccurred)} />
              <Detail label="Year installed" value={incident.yearInstalled ?? '—'} />
              <Detail label="Fatalities / injuries" value={`${incident.fatalities} / ${incident.injuries}`} />
              <Detail
                label="Property damage"
                value={
                  incident.propertyDamageCost
                    ? `${Number(incident.propertyDamageCost).toLocaleString('en-GB')} XAF`
                    : '—'
                }
              />
              <Detail
                label="Gas released"
                value={incident.gasVolumeReleasedMcf ? `${incident.gasVolumeReleasedMcf} Mcf` : '—'}
              />
            </dl>
          </Card>

          <Card
            title="Corrective actions"
            action={
              incident.status !== 'CLOSED' && (
                <button
                  className="btn-secondary btn-xs"
                  onClick={() => setShowActionForm((v) => !v)}
                >
                  {showActionForm ? 'Cancel' : 'Raise action'}
                </button>
              )
            }
          >
            {showActionForm && (
              <form onSubmit={raiseAction} className="grid gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="What needs to be done">
                    <textarea
                      className="input min-h-[70px]"
                      value={actionForm.description}
                      onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                      minLength={5}
                      required
                    />
                  </Field>
                </div>
                <Field label="Assign to">
                  <select
                    className="input"
                    value={actionForm.assignedToId}
                    onChange={(e) => setActionForm({ ...actionForm, assignedToId: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due date">
                  <input
                    className="input"
                    type="date"
                    value={actionForm.dueDate}
                    onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <button className="btn-primary" disabled={busy}>
                    Raise corrective action
                  </button>
                </div>
              </form>
            )}

            {incident.correctiveActions.length === 0 ? (
              <Empty message="No corrective actions raised against this incident." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Assigned to</th>
                    <th>Due</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {incident.correctiveActions.map((action: any) => (
                    <tr key={action.id}>
                      <td className="whitespace-nowrap font-mono text-xs text-slate-500">
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
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Predicted severity"
            action={
              <button className="btn-secondary btn-xs" onClick={rescore} disabled={busy}>
                <IconRefresh className="h-3.5 w-3.5" />
                Re-score
              </button>
            }
          >
            <div className="px-4 py-4">
              {incident.predictedRiskScore === null || incident.predictedRiskScore === undefined ? (
                <p className="text-sm text-slate-400">
                  Not yet scored. The predictive service may have been unavailable when this record
                  was filed.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <Badge value={incident.predictedRiskLevel} />
                    <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900">
                      {Number(incident.predictedRiskScore).toFixed(3)}
                    </span>
                  </div>
                  <div className="mt-3 h-2.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2.5 rounded-full bg-brand-500"
                      style={{ width: `${Number(incident.predictedRiskScore) * 100}%` }}
                    />
                  </div>
                  <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <div className="flex justify-between gap-3">
                      <dt>Model</dt>
                      <dd className="text-right font-medium text-slate-600">
                        {incident.predictedByModel}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Scored</dt>
                      <dd className="text-right font-medium text-slate-600">
                        {formatDateTime(incident.predictedAt)}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          </Card>

          {/* The immutable trail, §9.4. */}
          <Card title="Audit trail">
            {incident.history?.length ? (
              <ol className="divide-y divide-slate-100">
                {incident.history.map((entry: any) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs font-medium text-slate-700">{humanise(entry.action)}</p>
                    {entry.previousState && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {humanise(entry.previousState)} → {humanise(entry.newState)}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {entry.user?.fullName ?? 'System'} · {formatDateTime(entry.timestamp)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty message="No trail entries." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value ? 'Yes' : 'No';
}
