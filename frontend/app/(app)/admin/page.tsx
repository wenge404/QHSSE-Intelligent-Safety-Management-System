'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { formatDate, formatDateTime, humanise, ROLE_LABELS } from '@/lib/format';
import { optionsOf, useEnums } from '@/lib/useEnums';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  InfoNote,
  PageHeader,
  Spinner,
  TableWrap,
  Tabs,
} from '@/components/ui';

type Tab = 'users' | 'zones' | 'templates' | 'hours' | 'log';

const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'zones', label: 'Zones' },
  { key: 'templates', label: 'Checklist templates' },
  { key: 'hours', label: 'Operational hours' },
  { key: 'log', label: 'Audit log' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const me = typeof window !== 'undefined' ? getStoredUser() : null;
  const isAdmin = me?.role === 'SYSTEM_ADMIN';

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'System' }, { label: 'Administration' }]}
        title="Administration"
        subtitle={
          isAdmin
            ? 'User and template management, and the immutable compliance trail.'
            : 'Read-only for your role. User and template management is System Admin only.'
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'users' && <UsersTab isAdmin={isAdmin} />}
      {tab === 'zones' && <ZonesTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'hours' && <HoursTab />}
      {tab === 'log' && <AuditLogTab />}
    </div>
  );
}

// ------------------------------------------------------------------- users

function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const { enums } = useEnums();
  const [users, setUsers] = useState<any[] | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'FIELD_REPORTER',
    department: '',
    zoneId: '',
  });

  const load = useCallback(async () => {
    try {
      setUsers((await api('/api/v1/admin/users')).data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    api('/api/v1/admin/zones').then((d) => setZones(d.data)).catch(() => setZones([]));
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          role: form.role,
          department: form.department || null,
          zoneId: form.zoneId ? Number(form.zoneId) : null,
        }),
      });
      setForm({ email: '', password: '', fullName: '', role: 'FIELD_REPORTER', department: '', zoneId: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />

      {isAdmin && (
        <Card title="Add a user">
          <form onSubmit={create} className="grid gap-4 px-4 py-4 sm:grid-cols-3">
            <Field label="Full name">
              <input
                className="input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Password" hint="Minimum 8 characters.">
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
                required
              />
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {optionsOf(enums, 'Role').map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role] ?? humanise(role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department" hint="Scope key for Department Lead visibility.">
              <input
                className="input"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="Home zone" hint="Scope key for QHSSE Auditor visibility.">
              <select
                className="input"
                value={form.zoneId}
                onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
              >
                <option value="">None</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-3">
              <button className="btn-primary" disabled={busy}>
                Create user
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Directory">
        {!users ? (
          <Spinner />
        ) : (
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Home zone</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium text-slate-700">{user.fullName}</td>
                  <td className="mono text-slate-500">{user.email}</td>
                  <td>{ROLE_LABELS[user.role] ?? humanise(user.role)}</td>
                  <td className="text-slate-600">{user.department ?? '—'}</td>
                  <td className="text-slate-600">{user.zone?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Access-control matrix (proposal §9.3)">
        <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Create incident / audit</th>
              <th>Dashboard visibility</th>
              <th>Approve &amp; verify actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-medium">Field Reporter</td>
              <td>Yes</td>
              <td>Own submissions only</td>
              <td>No</td>
            </tr>
            <tr>
              <td className="font-medium">QHSSE Auditor</td>
              <td>Yes</td>
              <td>Zone-level</td>
              <td>Audit-sourced actions only</td>
            </tr>
            <tr>
              <td className="font-medium">Department Lead</td>
              <td>Yes</td>
              <td>Department-level (all zones)</td>
              <td>All actions in department</td>
            </tr>
            <tr>
              <td className="font-medium">System Admin</td>
              <td>Yes</td>
              <td>Organisation-wide</td>
              <td>All, plus user &amp; template management</td>
            </tr>
          </tbody>
        </table>
        </TableWrap>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------- zones

function ZonesTab() {
  const [zones, setZones] = useState<any[] | null>(null);
  useEffect(() => {
    api('/api/v1/admin/zones').then((d) => setZones(d.data)).catch(() => setZones([]));
  }, []);

  return (
    <Card title="Operational zones">
      {!zones ? (
        <Spinner />
      ) : (
        <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Type</th>
              <th>Department</th>
              <th className="text-right">Incidents</th>
              <th className="text-right">Audits</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.id}>
                <td className="font-medium text-slate-700">{zone.name}</td>
                <td>{humanise(zone.zoneType)}</td>
                <td className="text-slate-600">{zone.department ?? '—'}</td>
                <td className="text-right tabular-nums">{zone._count.incidents}</td>
                <td className="text-right tabular-nums">{zone._count.audits}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableWrap>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- templates

function TemplatesTab() {
  const [templates, setTemplates] = useState<any[] | null>(null);
  useEffect(() => {
    api('/api/v1/admin/templates').then((d) => setTemplates(d.data)).catch(() => setTemplates([]));
  }, []);

  if (!templates) return <Spinner />;

  return (
    <div className="space-y-4">
      {templates.map((template) => (
        <Card key={template.id} title={template.name}>
          <div className="px-4 py-4">
            <div className="flex flex-wrap items-baseline gap-3">
              {template.isoClause && (
                <span className="pill border-slate-200 bg-slate-50 font-mono text-slate-500">
                  {template.isoClause}
                </span>
              )}
              <span className="text-xs text-slate-400">
                {template.items.length} items · used by {template._count.audits} audit
                {template._count.audits === 1 ? '' : 's'}
              </span>
            </div>
            {template.description && (
              <p className="mt-2 text-sm text-slate-600">{template.description}</p>
            )}
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-slate-700">
              {template.items.map((item: any) => (
                <li key={item.id}>{item.itemText}</li>
              ))}
            </ol>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- hours

function HoursTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', personHours: '' });

  const load = useCallback(async () => {
    try {
      setRows((await api('/api/v1/admin/operational-hours')).data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/admin/operational-hours', {
        method: 'POST',
        body: JSON.stringify({
          periodStart: new Date(form.periodStart).toISOString(),
          periodEnd: new Date(form.periodEnd).toISOString(),
          personHours: Number(form.personHours),
        }),
      });
      setForm({ periodStart: '', periodEnd: '', personHours: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />
      <Card title="Log operational person-hours">
        <div className="px-4 pt-3">
          <InfoNote>
            The denominator of the Near-Miss Frequency Rate. Without it the NMFR tile has nothing to
            divide by and reports “no person-hours logged” rather than a misleading zero.
          </InfoNote>
        </div>
        <form onSubmit={submit} className="grid gap-4 px-4 py-4 sm:grid-cols-4">
          <Field label="Period start">
            <input
              className="input"
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              required
            />
          </Field>
          <Field label="Period end">
            <input
              className="input"
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              required
            />
          </Field>
          <Field label="Person-hours">
            <input
              className="input"
              type="number"
              min={1}
              value={form.personHours}
              onChange={(e) => setForm({ ...form, personHours: e.target.value })}
              required
            />
          </Field>
          <div className="flex items-end">
            <button className="btn-primary w-full" disabled={busy}>
              Record
            </button>
          </div>
        </form>
      </Card>

      <Card title="Logged periods">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty message="No person-hours recorded." />
        ) : (
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Zone</th>
                <th className="text-right">Person-hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {formatDate(row.periodStart)} — {formatDate(row.periodEnd)}
                  </td>
                  <td className="text-slate-600">{row.zone?.name ?? 'All zones'}</td>
                  <td className="text-right tabular-nums">
                    {Number(row.personHours).toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------- audit log

function AuditLogTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (entityType) params.set('entityType', entityType);
    setData(null);
    api(`/api/v1/admin/audit-log?${params}`).then(setData).catch(setError);
  }, [page, entityType]);

  if (error) return <ErrorNote error={error} />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <select
            className="input w-auto"
            value={entityType}
            onChange={(e) => {
              setPage(1);
              setEntityType(e.target.value);
            }}
          >
            <option value="">All entity types</option>
            {['INCIDENT', 'AUDIT', 'CORRECTIVE_ACTION', 'USER', 'CHECKLIST_TEMPLATE', 'AUTH'].map(
              (type) => (
                <option key={type} value={type}>
                  {humanise(type)}
                </option>
              ),
            )}
          </select>
          <p className="text-[11.5px] text-slate-500">
            Insert-only. The API exposes no update or delete route for this table.
          </p>
        </div>
      </Card>

      <Card>
        {!data ? (
          <Spinner />
        ) : (
          <>
            <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Transition</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((entry: any) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-[11.5px] text-slate-500">
                      {formatDateTime(entry.timestamp)}
                    </td>
                    <td className="whitespace-nowrap text-slate-700">
                      {entry.user?.fullName ?? 'System'}
                    </td>
                    <td className="whitespace-nowrap text-xs">{humanise(entry.action)}</td>
                    <td className="mono whitespace-nowrap text-slate-500">
                      {entry.entityType} #{entry.entityId}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {entry.previousState || entry.newState ? (
                        <span className="flex items-center gap-1.5">
                          {entry.previousState && <Badge value={entry.previousState} />}
                          {entry.previousState && entry.newState && (
                            <span className="text-slate-300">→</span>
                          )}
                          {entry.newState && <Badge value={entry.newState} />}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableWrap>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-[12.5px]">
              <button
                className="btn-secondary btn-xs"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-slate-500">
                Page {data.pagination.page} of {data.pagination.pages} ·{' '}
                {data.pagination.total.toLocaleString()} entries
              </span>
              <button
                className="btn-secondary btn-xs"
                disabled={page >= data.pagination.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
