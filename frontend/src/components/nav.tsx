'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/lists', label: 'Contacts' },
  { href: '/messages', label: 'Templates' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/linkedin', label: 'LinkedIn' },
  { href: '/settings', label: 'Settings' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function UserInitials({ email }: { email?: string }) {
  const initials = email ? email.slice(0, 2).toUpperCase() : 'HN';
  return (
    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
      {initials}
    </div>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const { token, ready, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!ready || !token) return null;

  return (
    <header className="sticky top-0 z-50 bg-surface/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between h-14 px-5">
        <Link href="/" className="text-xl font-extrabold text-dark tracking-tight shrink-0">
          Hack<span className="text-primary">-Nation</span>
        </Link>

        <nav className="hidden md:flex items-center gap-0.5 ml-10">
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative px-3.5 py-2 text-[13px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-dark-5 hover:text-dark'
                }`}
              >
                <span className="relative z-10">{l.label}</span>
                {active && (
                  <motion.div
                    layoutId="nav-underline"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring' as const, stiffness: 400, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={logout}
            className="hidden md:block text-[13px] text-dark-6 hover:text-dark transition-colors"
          >
            Log out
          </button>
          <UserInitials />

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-dark-5 hover:text-dark transition-colors p-1"
            aria-label="Menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              }
            </svg>
          </button>
        </div>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-stroke to-transparent" />

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const }}
            className="md:hidden overflow-hidden bg-surface border-b border-stroke"
          >
            <div className="px-4 py-2 divide-y divide-stroke/50">
              <div className="space-y-0.5 pb-2">
                {links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMobileOpen(false)}
                      className={`block px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        active ? 'text-primary bg-primary-dim' : 'text-dark-5 hover:text-dark hover:bg-surface-2'
                      }`}
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </div>
              <div className="pt-2">
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  className="block w-full text-left px-3 py-2.5 rounded-xl text-sm text-dark-5 hover:text-dark hover:bg-surface-2 transition-colors"
                >
                  Log out
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
