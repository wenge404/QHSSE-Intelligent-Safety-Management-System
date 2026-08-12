'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { optionsOf, useEnums } from '@/lib/useEnums';
import { Badge, Card, ErrorNote, Field, InfoNote, PageHeader } from '@/components/ui';

interface Prediction {
  probability: number;
  riskLevel: string;
  model: string;
  featureSet: string;
  threshold: number;
  predictedSignificant: boolean;
  baseRate: number;
}

const EMPTY = {
  type: 'INCIDENT',
  title: '',
  description: '',
  occurredAt: new Date().toISOString().slice(0, 16),
  zoneId: '',
  causeCategory: '',
  systemPart: '',
  locationType: '',
  linePressurePsig: '',
  pipeDiameterInches: '',
  ignitionOccurred: '',
  explosionOccurred: '',
  pipeMaterial: '',
  releaseType: '',
  incidentAreaType: '',
  yearInstalled: '',
  severity: 'LOW',
  fatalities: '0',
  injuries: '0',
  propertyDamageCost: '',
  gasVolumeReleasedMcf: '',
  evacuationCount: '0',
};

export default function NewIncidentPage() {
  const router = useRouter();
  const { enums } = useEnums();
  const [form, setForm] = useState(EMPTY);
  const [zones, setZones] = useState<{ id: number; name: string }[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/v1/admin/zones')
      .then((data) => setZones(data.data))
      .catch(() => setZones([]));
  }, []);

  function set(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const bool = (value: string) => (value === '' ? null : value === 'true');
  const num = (value: string) => (value === '' ? null : Number(value));

  /** The exact payload the model sees — consequence fields are never included. */
  const modelPayload = useMemo(
    () => ({
      causeCategory: form.causeCategory || null,
      systemPart: form.systemPart || null,
      locationType: form.locationType || null,
      linePressurePsig: num(form.linePressurePsig),
      pipeDiameterInches: num(form.pipeDiameterInches),
      ignitionOccurred: bool(form.ignitionOccurred),
      explosionOccurred: bool(form.explosionOccurred),
      pipeMaterial: form.pipeMaterial || null,
      releaseType: form.releaseType || null,
      incidentAreaType: form.incidentAreaType || null,
      pipeAgeYears:
        form.yearInstalled && form.occurredAt
          ? new Date(form.occurredAt).getFullYear() - Number(form.yearInstalled)
          : null,
      featureSet: 'B' as const,
    }),
    [form],
  );

  const score = useCallback(async () => {
    // Nothing worth scoring until at least a cause is chosen.
    if (!form.causeCategory) {
      setPrediction(null);
      return;
    }
    try {
      setPredictionError(null);
      setPrediction(await api<Prediction>('/api/v1/predict', {
        method: 'POST',
        body: JSON.stringify(modelPayload),
      }));
    } catch (err) {
      setPrediction(null);
      setPredictionError(err instanceof Error ? err.message : 'Scoring unavailable');
    }
  }, [modelPayload, form.causeCategory]);

  useEffect(() => {
    const timer = setTimeout(score, 350);
    return () => clearTimeout(timer);
  }, [score]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api('/api/v1/incidents', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          title: form.title,
          description: form.description,
          occurredAt: new Date(form.occurredAt).toISOString(),
          zoneId: form.zoneId ? Number(form.zoneId) : null,
          causeCategory: form.causeCategory || null,
          systemPart: form.systemPart || null,
          locationType: form.locationType || null,
          linePressurePsig: num(form.linePressurePsig),
          pipeDiameterInches: num(form.pipeDiameterInches),
          ignitionOccurred: bool(form.ignitionOccurred),
          explosionOccurred: bool(form.explosionOccurred),
          pipeMaterial: form.pipeMaterial || null,
          releaseType: form.releaseType || null,
          incidentAreaType: form.incidentAreaType || null,
          yearInstalled: num(form.yearInstalled),
          severity: form.severity,
          fatalities: Number(form.fatalities || 0),
          injuries: Number(form.injuries || 0),
          propertyDamageCost: num(form.propertyDamageCost),
          gasVolumeReleasedMcf: num(form.gasVolumeReleasedMcf),
          evacuationCount: Number(form.evacuationCount || 0),
        }),
      });
      router.push(`/incidents/${created.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const selectFor = (key: keyof typeof EMPTY, enumName: string) => (
    <select className="input" value={form[key]} onChange={(e) => set(key, e.target.value)}>
      <option value="">Not specified</option>
      {optionsOf(enums, enumName).map((option) => (
        <option key={option} value={option}>
          {humanise(option)}
        </option>
      ))}
    </select>
  );

  const yesNo = (key: keyof typeof EMPTY) => (
    <select className="input" value={form[key]} onChange={(e) => set(key, e.target.value)}>
      <option value="">Not specified</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Operations' },
          { label: 'Incidents', href: '/incidents' },
          { label: 'New report' },
        ]}
        title="Report an incident or near-miss"
        subtitle="Saved as a draft in your name. Submit it from the record page when you are ready for it to enter the investigation workflow."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="What happened">
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
              <Field label="Record type">
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => set('type', e.target.value)}
                >
                  <option value="INCIDENT">Incident</option>
                  <option value="NEAR_MISS">Near-miss</option>
                </select>
              </Field>
              <Field label="Date and time it occurred">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.occurredAt}
                  onChange={(e) => set('occurredAt', e.target.value)}
                  required
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Title">
                  <input
                    className="input"
                    value={form.title}
                    onChange={(e) => set('title', e.target.value)}
                    placeholder="Third-party excavation strike on distribution main"
                    minLength={4}
                    required
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Description" hint="What happened, what was done, and what state the asset is in now.">
                  <textarea
                    className="input min-h-[120px]"
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    minLength={10}
                    required
                  />
                </Field>
              </div>
              <Field label="Zone">
                <select
                  className="input"
                  value={form.zoneId}
                  onChange={(e) => set('zoneId', e.target.value)}
                >
                  <option value="">Not yet identified</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Assessed severity" hint="Your judgement, independent of the model score.">
                {selectFor('severity', 'RiskLevel')}
              </Field>
            </div>
          </Card>

          <Card title="Circumstances — model feature set A">
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="Primary hazard cause" hint="PHMSA 8-category taxonomy">
                {selectFor('causeCategory', 'CauseCategory')}
              </Field>
              <Field label="Component type">{selectFor('systemPart', 'SystemPart')}</Field>
              <Field label="Environmental location">
                {selectFor('locationType', 'LocationType')}
              </Field>
              <Field label="Line pressure at incident (PSIG)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={5000}
                  step="0.1"
                  value={form.linePressurePsig}
                  onChange={(e) => set('linePressurePsig', e.target.value)}
                />
              </Field>
              <Field label="Nominal diameter (inches)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={120}
                  step="0.1"
                  value={form.pipeDiameterInches}
                  onChange={(e) => set('pipeDiameterInches', e.target.value)}
                />
              </Field>
              <Field label="Year installed" hint="Used to derive pipe age at time of incident.">
                <input
                  className="input"
                  type="number"
                  min={1900}
                  max={2100}
                  value={form.yearInstalled}
                  onChange={(e) => set('yearInstalled', e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card title="Incident characteristics — model feature set B">
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="Ignition occurred">{yesNo('ignitionOccurred')}</Field>
              <Field label="Explosion occurred">{yesNo('explosionOccurred')}</Field>
              <Field label="Pipe material">{selectFor('pipeMaterial', 'PipeMaterial')}</Field>
              <Field label="Release type">{selectFor('releaseType', 'ReleaseType')}</Field>
              <Field label="Incident area">{selectFor('incidentAreaType', 'IncidentAreaType')}</Field>
            </div>
          </Card>

          <Card title="Consequences">
            <div className="px-4 pt-3">
              <InfoNote>
                Recorded for reporting and KPI purposes only. These fields are deliberately never
                sent to the predictive model — the PHMSA SIGNIFICANT label is derived from them, so
                a model given them would be reconstructing its own answer.
              </InfoNote>
            </div>
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
              <Field label="Fatalities">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.fatalities}
                  onChange={(e) => set('fatalities', e.target.value)}
                />
              </Field>
              <Field label="Injuries">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.injuries}
                  onChange={(e) => set('injuries', e.target.value)}
                />
              </Field>
              <Field label="Evacuated">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.evacuationCount}
                  onChange={(e) => set('evacuationCount', e.target.value)}
                />
              </Field>
              <Field label="Property damage (XAF)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.propertyDamageCost}
                  onChange={(e) => set('propertyDamageCost', e.target.value)}
                />
              </Field>
              <Field label="Gas released (Mcf)">
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.gasVolumeReleasedMcf}
                  onChange={(e) => set('gasVolumeReleasedMcf', e.target.value)}
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* Live scoring panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            <Card title="Live severity triage">
              <div className="px-4 py-4">
                {!form.causeCategory ? (
                  <p className="text-sm text-slate-400">
                    Choose a primary hazard cause to score this report.
                  </p>
                ) : predictionError ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {predictionError}
                    <p className="mt-1 text-amber-700">
                      You can still file the report — scoring is never allowed to block a safety
                      record.
                    </p>
                  </div>
                ) : !prediction ? (
                  <p className="text-sm text-slate-400">Scoring…</p>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <Badge value={prediction.riskLevel} />
                      <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900">
                        {prediction.probability.toFixed(3)}
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="relative h-2.5 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2.5 rounded-full bg-brand-500 transition-all"
                          style={{ width: `${prediction.probability * 100}%` }}
                        />
                        <div
                          className="absolute -top-1 h-4.5 w-0.5 bg-red-500"
                          style={{ left: `${prediction.threshold * 100}%`, height: '1.125rem' }}
                          title={`Operating threshold ${prediction.threshold.toFixed(3)}`}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
                        <span>0.0</span>
                        <span>threshold {prediction.threshold.toFixed(2)}</span>
                        <span>1.0</span>
                      </div>
                    </div>

                    <p className="mt-4 text-sm text-slate-600">
                      {prediction.predictedSignificant ? (
                        <>
                          Modelled as <strong>likely significant</strong> under PHMSA&rsquo;s
                          definition. Prioritise investigation.
                        </>
                      ) : (
                        <>
                          Modelled as <strong>below the escalation threshold</strong>. Handle through
                          the normal queue.
                        </>
                      )}
                    </p>

                    <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <div className="flex justify-between gap-3">
                        <dt>Model</dt>
                        <dd className="text-right font-medium text-slate-600">{prediction.model}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Feature set</dt>
                        <dd className="text-right font-medium text-slate-600">
                          {prediction.featureSet} (triage)
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Training base rate</dt>
                        <dd className="text-right font-medium text-slate-600">
                          {prediction.baseRate.toFixed(3)}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>
            </Card>

            <InfoNote>
              <p className="font-semibold text-slate-700">What this score is</p>
              <p className="mt-1">
                A severity <em>triage</em> aid, not a forecast. It estimates whether an incident that
                has already occurred meets PHMSA&rsquo;s SIGNIFICANT threshold, to help prioritise
                investigation. It does not predict which asset will fail next.
              </p>
            </InfoNote>
          </div>
        </div>
      </div>

      <ErrorNote error={error} />

      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={() => router.back()}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
      </div>
    </form>
  );
}
