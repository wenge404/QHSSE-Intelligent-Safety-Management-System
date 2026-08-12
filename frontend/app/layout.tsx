import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IQSMS — Intelligent QHSSE Safety Management System',
  description:
    'Incident tracking, audit management and predictive risk classification for Gaz du Cameroun.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
