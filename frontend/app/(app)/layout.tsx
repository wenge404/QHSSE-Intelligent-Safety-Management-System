'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearSession, getStoredUser, getToken, SessionUser } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/format';
import {
  IconAction,
  IconAdmin,
  IconAudit,
  IconDashboard,
  IconIncident,
  IconModel,
  IconSignOut,
} from '@/components/icons';

const NAV_GROUPS: {
  heading: string;
  items: { href: string; label: string; Icon: (p: { className?: string }) => JSX.Element }[];
}[] = [
  {
    heading: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', Icon: IconDashboard }],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/incidents', label: 'Incidents', Icon: IconIncident },
      { href: '/audits', label: 'Audits', Icon: IconAudit },
      { href: '/actions', label: 'Corrective actions', Icon: IconAction },
    ],
  },
  {
    heading: 'Analytics',
    items: [{ href: '/model', label: 'Risk model', Icon: IconModel }],
  },
  {
    heading: 'System',
    items: [{ href: '/admin', label: 'Administration', Icon: IconAdmin }],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getStoredUser());
    setReady(true);
  }, [router]);

  function signOut() {
    clearSession();
    router.replace('/login');
  }

  if (!ready) return null;

  const initials = (user?.fullName ?? '')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* ------------------------------ sidebar ------------------------------ */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col bg-brand-900 lg:flex">
        <div className="flex h-[52px] items-center gap-2.5 border-b border-white/10 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-brand-500 text-[12px] font-bold text-white">
            IQ
          </span>
          <div className="leading-none">
            <p className="text-[13px] font-semibold text-white">IQSMS</p>
            <p className="mt-[3px] text-[10px] uppercase tracking-[0.08em] text-brand-300">
              QHSSE · IMS
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="mb-5">
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-brand-400/70">
                {group.heading}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(({ href, label, Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`nav-item ${active ? 'nav-item-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className="h-[17px] w-[17px] shrink-0" />
                        <span className="truncate">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3">
          <p className="text-[10px] leading-relaxed text-brand-400/80">
            Gaz du Cameroun · Logbaba
            <br />
            Douala, Cameroon
          </p>
        </div>
      </aside>

      {/* ------------------------------- main -------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[232px]">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between gap-4 border-b border-slate-200 bg-white px-5">
          {/* Compact nav for narrow screens, where the sidebar is hidden. */}
          <nav className="flex items-center gap-1 overflow-x-auto lg:hidden">
            {NAV_GROUPS.flatMap((g) => g.items).map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={`rounded p-2 transition ${
                    active ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </Link>
              );
            })}
          </nav>

          <p className="hidden text-[12px] text-slate-400 lg:block">
            Intelligent QHSSE Safety Management System
          </p>

          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-[13px] font-medium text-slate-800">{user.fullName}</p>
                <p className="text-[11px] text-slate-400">
                  {ROLE_LABELS[user.role]} · {user.scopeLabel}
                </p>
              </div>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                {initials}
              </span>
              <button
                onClick={signOut}
                className="btn-ghost px-2"
                title="Sign out"
                aria-label="Sign out"
              >
                <IconSignOut className="h-[17px] w-[17px]" />
              </button>
            </div>
          )}
        </header>

        <main className="flex-1 px-5 py-6 lg:px-7">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>

        <footer className="px-5 pb-6 lg:px-7">
          <div className="mx-auto max-w-[1400px] border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-400">
            Operational records are synthetic, modelled on GDC Logbaba fields. The predictive model
            is trained on the public PHMSA gas distribution incident dataset (2010–present) against
            PHMSA&rsquo;s own SIGNIFICANT incident classification.
          </div>
        </footer>
      </div>
    </div>
  );
}
