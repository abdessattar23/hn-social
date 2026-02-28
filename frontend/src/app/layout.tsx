import type { Metadata } from 'next';
import './globals.css';
import ClientShell from '@/components/client-shell';

export const metadata: Metadata = {
  title: 'Hack-Nation',
  description: 'Enterprise social media & outreach platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-gray-1 text-dark antialiased">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
