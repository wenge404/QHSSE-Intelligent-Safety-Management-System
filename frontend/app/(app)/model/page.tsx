'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { Card, ErrorNote, PageHeader, Spinner, TableWrap } from '@/components/ui';

interface MetricStat {
  mean: number;
  std: number;
}

interface FeatureSetReport {
  claim: string;
  description: string;
  categorical: string[];
  numeric: string[];
  best_model: string;
  threshold: number;
  threshold_precision: number;
  threshold_recall: number;
  confusion_matrix: number[][];
  metrics: Record<string, Record<string, MetricStat>>;
}

interface Report {
  generated_at: string;
  target: string;
  rows_before_ff_filter: number;
  rows_after_ff_filter: number;
  base_rate: number;
  majority_baseline: number;
  leakage_excluded: string[];
  smote_applied: boolean;
  smote_rationale: string;
  feature_sets: Record<string, FeatureSetReport>;
}

const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'prc_auc'] as const;
const METRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  precision: 'Precision',
  recall: 'Recall',
  f1: 'F1',
  prc_auc: 'PRC-AUC',
};

export default function ModelPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Report>('/api/v1/predict/models').then(setReport).catch(setError);
  }, []);

  if (error) return <ErrorNote error={error} />;
  if (!report) return <Spinner label="Loading model evaluation…" />;

  const setB = report.feature_sets.B;
  const setA = report.feature_sets.A;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Analytics' }, { label: 'Risk model' }]}
        title="Predictive risk model"
        subtitle={`Cross-validated comparison behind the score shown on every incident. Trained on ${report.rows_after_ff_filter.toLocaleString()} PHMSA gas distribution records against the ${report.target} flag.`}
      />

      {/* The headline honesty check. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Records used" value={report.rows_after_ff_filter.toLocaleString()} sub={`${report.rows_before_ff_filter - report.rows_after_ff_filter} fire-first rows dropped`} />
        <Fact
          label="Class balance"
          value={`${(report.base_rate * 100).toFixed(0)} / ${((1 - report.base_rate) * 100).toFixed(0)}`}
          sub="significant / not"
        />
        <Fact
          label="Majority baseline"
          value={report.majority_baseline.toFixed(3)}
          sub="accuracy to beat"
        />
        <Fact label="SMOTE" value={report.smote_applied ? 'Applied' : 'Rejected'} sub="on evidence" />
      </div>

      <Card title="The two claims these feature sets support">
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
          {(['A', 'B'] as const).map((key) => {
            const set = report.feature_sets[key];
            const served = key === 'B';
            return (
              <div key={key} className="bg-white px-5 py-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold text-slate-800">
                    Set {key} — {set.claim}
                  </h3>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${
                      served
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {served ? 'Served' : 'Baseline only'}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">{set.description}</p>
                <p className="mt-3 text-xs text-slate-500">
                  Best: <span className="font-medium text-slate-700">{set.best_model}</span> ·
                  PRC-AUC{' '}
                  <span className="font-mono">
                    {set.metrics[set.best_model].prc_auc.mean.toFixed(3)}
                  </span>{' '}
                  vs <span className="font-mono">{report.base_rate.toFixed(3)}</span> no-skill
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {(['A', 'B'] as const).map((key) => {
        const set = report.feature_sets[key];
        return (
          <Card key={key} title={`Feature set ${key} — stratified 5-fold cross-validation`}>
            <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Model</th>
                  {METRICS.map((metric) => (
                    <th key={metric} className="text-right">
                      {METRIC_LABELS[metric]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(set.metrics).map(([model, metrics]) => (
                  <tr key={model} className={model === set.best_model ? 'bg-brand-50/50' : undefined}>
                    <td className="whitespace-nowrap font-medium text-slate-700">
                      {model}
                      {model === set.best_model && (
                        <span className="ml-2 text-xs font-normal text-brand-600">selected</span>
                      )}
                    </td>
                    {METRICS.map((metric) => (
                      <td key={metric} className="text-right font-mono text-xs tabular-nums">
                        {metrics[metric].mean.toFixed(3)}
                        <span className="text-slate-400"> ±{metrics[metric].std.toFixed(3)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </TableWrap>
            <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
              Operating threshold <span className="font-mono">{set.threshold.toFixed(3)}</span> —
              the most selective cut-off still catching{' '}
              <span className="font-mono">{(set.threshold_recall * 100).toFixed(1)}%</span> of
              significant incidents, at{' '}
              <span className="font-mono">{(set.threshold_precision * 100).toFixed(1)}%</span>{' '}
              precision. Confusion matrix at that threshold:{' '}
              <span className="font-mono">
                TN {set.confusion_matrix[0][0]} · FP {set.confusion_matrix[0][1]} · FN{' '}
                {set.confusion_matrix[1][0]} · TP {set.confusion_matrix[1][1]}
              </span>
            </div>
          </Card>
        );
      })}

      <Card title="What set B buys over set A">
        <div className="px-4 py-4 text-[13px] leading-relaxed text-slate-700">
          <p>
            Compared at the <strong>same recall</strong> — both thresholds are tuned to catch{' '}
            {(setB.threshold_recall * 100).toFixed(0)}% of significant incidents — set B correctly
            clears <strong>{setB.confusion_matrix[0][0]}</strong> non-significant incidents against
            set A&rsquo;s <strong>{setA.confusion_matrix[0][0]}</strong>. That is the number that
            matters operationally: it is how much genuine filtering the triage tool does before a
            human looks at the queue, at an identical safety level.
          </p>
          <p className="mt-3">
            Set A on its own is a <strong>null result</strong> and is reported as one. Its accuracy
            of {formatNumber(setA.metrics[setA.best_model].accuracy.mean, 3)} sits at or below the{' '}
            {report.majority_baseline.toFixed(3)} majority-class baseline — cause, component,
            location, pressure and diameter alone do not determine whether a gas distribution
            incident becomes significant.
          </p>
          <p className="mt-3">
            The honest claim is therefore <strong>severity triage, not prevention</strong>. The model
            helps prioritise which logged incidents warrant escalation; it does not forecast which
            pipeline segment will fail.
          </p>
        </div>
      </Card>

      <Card title="Leakage control">
        <div className="px-4 py-4">
          <p className="text-[13px] leading-relaxed text-slate-700">
            The <span className="font-mono">SIGNIFICANT</span> flag is computed from fatality count,
            injury count, total cost in 1984 dollars, and the fire-first indicator. Supplying any of
            those as features would let a model reconstruct the label&rsquo;s own definition,
            producing near-perfect scores of no predictive value. An accuracy above ~0.95 on this
            problem is a symptom of leakage, not success.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            {report.leakage_excluded.length} columns excluded
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {report.leakage_excluded.map((column) => (
              <span
                key={column}
                className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-xs text-red-700"
              >
                {column}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Class balance treatment">
        <p className="px-4 py-4 text-[13px] leading-relaxed text-slate-700">{report.smote_rationale}</p>
      </Card>

      <p className="text-[11.5px] text-slate-400">
        Report generated {new Date(report.generated_at).toLocaleString('en-GB')} by{' '}
        <span className="font-mono">services/ml/train.py</span>. Regenerate with{' '}
        <span className="font-mono">python train.py</span>.
      </p>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
    </div>
  );
}
