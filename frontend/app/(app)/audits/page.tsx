'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Field,
  PageHeader,
  Spinner,
  TableWrap,
} from '@/components/ui';
import { IconPlus } from '@/components/icons';

export default function AuditsPage() {
  const [audits, setAudits] = useState<any[] | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ templateId: '', zoneId: '', scheduledDate: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/v1/audits');
      setAudits(data.data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    api('/api/v1/admin/templates').then((d) => setTemplates(d.data)).catch(() => setTemplates([]));
    api('/api/v1/admin/zones').then((d) => setZones(d.data)).catch(() => setZones([]));
  }, [load]);

  async function schedule(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/audits', {
        method: 'POST',
        body: JSON.stringify({
          templateId: Number(form.templateId),
          zoneId: form.zoneId ? Number(form.zoneId) : null,
          scheduledDate: new Date(form.scheduledDate).toISOString(),
        }),
      });
      setShowForm(false);
      setForm({ templateId: '', zoneId: '', scheduledDate: '' });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Audits' }]}
        title="Audits &amp; inspections"
        subtitle="Checklist runs against a template — the ISO 9001 §9.2 internal-audit record"
        actions={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {!showForm && <IconPlus className="h-4 w-4" />}
            {showForm ? 'Cancel' : 'Schedule audit'}
          </button>
        }
      />

      <ErrorNote error={error} />

      {showForm && (
        <Card title="Schedule a new audit">
          <form onSubmit={schedule} className="grid gap-4 px-4 py-4 sm:grid-cols-3">
            <Field label="Checklist template">
              <select
                className="input"
                value={form.templateId}
                onChange={(e) => setForm({ ...form, templateId: e.target.value })}
                required
              >
                <option value="">Select…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.items.length} items)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zone">
              <select
                className="input"
                value={form.zoneId}
                onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
              >
                <option value="">Not zone-specific</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scheduled date">
              <input
                className="input"
                type="date"
                value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
                required
              />
            </Field>
            <div className="sm:col-span-3">
              <button className="btn-primary" disabled={busy}>
                Schedule
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {!audits ? (
          <Spinner />
        ) : audits.length === 0 ? (
          <Empty message="No audits within your access scope." />
        ) : (
          <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Template</th>
                <th>ISO clause</th>
                <th>Zone</th>
                <th>Conducted by</th>
                <th>Scheduled</th>
                <th>Progress</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td className="mono whitespace-nowrap text-slate-500">
                    <Link href={`/audits/${audit.id}`} className="hover:text-brand-600">
                      {audit.referenceNumber}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={`/audits/${audit.id}`}
                      className="font-medium text-slate-800 hover:text-brand-600"
                    >
                      {audit.template.name}
                    </Link>
                  </td>
                  <td className="mono whitespace-nowrap text-slate-500">
                    {audit.template.isoClause ?? '—'}
                  </td>
                  <td className="text-slate-600">{audit.zone?.name ?? '—'}</td>
                  <td className="whitespace-nowrap text-slate-600">{audit.conductedBy.fullName}</td>
                  <td className="whitespace-nowrap text-slate-600">
                    {formatDate(audit.scheduledDate)}
                  </td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">
                    {audit._count.responses}/{audit.template._count.items}
                  </td>
                  <td>
                    <Badge value={audit.status} />
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
