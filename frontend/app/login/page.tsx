'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

const DEMO_ACCOUNTS = [
  { email: 'admin@gdc.cm', role: 'System Admin', scope: 'Organisation-wide' },
  { email: 'lead.integrity@gdc.cm', role: 'Department Lead', scope: 'Pipeline Integrity' },
  { email: 'auditor.sectiona@gdc.cm', role: 'QHSSE Auditor', scope: 'Pipeline Section A' },
  { email: 'reporter.field@gdc.cm', role: 'Field Reporter', scope: 'Own submissions' },
];

const MODULES = [
  { name: 'Incident & near-miss management', clause: 'ISO 45001:2018 §10.2' },
  { name: 'Audit & inspection management', clause: 'ISO 9001:2015 §9.2' },
  { name: 'Predictive risk module', clause: 'ISO 14001:2015 §6.1' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@gdc.cm');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef1f6] px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:grid-cols-[1.05fr_1fr]">
        {/* ---------------------------- brand panel --------------------------- */}
        <div className="bg-brand-900 p-9 text-white md:p-11">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded bg-brand-500 text-[13px] font-bold">
              IQ
            </span>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold">IQSMS</p>
              <p className="text-[10px] uppercase tracking-[0.09em] text-brand-300">
                Gaz du Cameroun · Logbaba
              </p>
            </div>
          </div>

          <h1 className="mt-9 text-[22px] font-semibold leading-snug">
            Intelligent QHSSE Safety
            <br />
            Management System
          </h1>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-brand-200">
            Incident and near-miss tracking, digital audit management, workflow-based corrective
            actions, and real-time predictive risk classification.
          </p>

          <dl className="mt-9 space-y-0 border-t border-white/15">
            {MODULES.map((module) => (
              <div
                key={module.name}
                className="flex items-center justify-between gap-4 border-b border-white/10 py-2.5"
              >
                <dt className="text-[12.5px] text-brand-100">{module.name}</dt>
                <dd className="shrink-0 font-mono text-[10.5px] text-brand-300">{module.clause}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-[11px] leading-relaxed text-brand-400">
            Operational records are synthetic. The predictive model is trained on the public PHMSA
            gas distribution incident dataset (2010–present).
          </p>
        </div>

        {/* ----------------------------- sign in ------------------------------ */}
        <div className="p-9 md:p-11">
          <h2 className="text-[17px] font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Use a demo account below, or your own credentials.
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <ErrorNote error={error} />

            <button className="btn-primary w-full py-2.5" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-8 border-t border-slate-200 pt-5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-400">
              Demo accounts · password <span className="font-mono normal-case">Password123!</span>
            </p>
            <ul className="mt-2.5 divide-y divide-slate-100">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => setEmail(account.email)}
                    className="group flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px] text-slate-600 group-hover:text-brand-600">
                        {account.email}
                      </span>
                      <span className="block text-[11px] text-slate-400">{account.scope}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-500">
                      {account.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 px-2 text-[11.5px] leading-relaxed text-slate-400">
              Each role sees a different slice of the same data — sign in as more than one to see the
              access-control matrix at work.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
