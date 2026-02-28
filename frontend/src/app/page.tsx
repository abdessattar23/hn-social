'use client';
import { useEffect, useState } from 'react';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { api } from '@/lib/api';
import Link from 'next/link';
import { AnimatedPage, AnimatedCard, AnimatedNumber, StaggerContainer, StaggerItem, FadeIn } from '@/components/motion';

type Campaign = {
  id: number;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  message: { name: string; type: string };
  createdAt: string;
  scheduledAt: string | null;
};

const statusStyle: Record<string, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-surface-2', text: 'text-dark-5', dot: 'bg-dark-6' },
  SCHEDULED: { bg: 'bg-primary-dim', text: 'text-primary', dot: 'bg-primary' },
  SENDING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark', dot: 'bg-yellow-dark' },
  SENT: { bg: 'bg-green-light-7', text: 'text-green', dot: 'bg-green' },
  FAILED: { bg: 'bg-red-light-6', text: 'text-red', dot: 'bg-red' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const cardAccents = ['border-l-primary', 'border-l-accent', 'border-l-yellow-dark'];

export default function Dashboard() {
  const { authed } = useRequireAuth();
  const [stats, setStats] = useState({ lists: 0, messages: 0, campaigns: 0 });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!authed) return;
    Promise.all([
      api.get('/lists'),
      api.get('/messages'),
      api.get('/campaigns'),
    ]).then(([lists, messages, camps]) => {
      setStats({
        lists: Array.isArray(lists) ? lists.length : 0,
        messages: Array.isArray(messages) ? messages.length : 0,
        campaigns: Array.isArray(camps) ? camps.length : 0,
      });
      setCampaigns(Array.isArray(camps) ? camps.slice(0, 8) : []);
      setLoaded(true);
    }).catch(() => { setLoaded(true); });
  }, [authed]);

  if (!authed) return null;

  const cards = [
    {
      label: 'Contact Lists',
      value: stats.lists,
      href: '/lists',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      ),
    },
    {
      label: 'Templates',
      value: stats.messages,
      href: '/messages',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
        </svg>
      ),
    },
    {
      label: 'Campaigns',
      value: stats.campaigns,
      href: '/campaigns',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
    },
  ];

  return (
    <AnimatedPage className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-dark">Welcome back</h1>
        <p className="text-sm text-dark-5 mt-1">Here&apos;s what&apos;s happening with your outreach.</p>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/campaigns/new" className="inline-flex items-center gap-2 bg-primary hover:bg-accent text-white rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Campaign
        </Link>
        <Link href="/lists" className="inline-flex items-center gap-2 border border-stroke text-dark-5 hover:text-dark hover:border-dark-6 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New List
        </Link>
      </div>

      <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-4" delayStart={0.08}>
        {cards.map((c, i) => (
          <StaggerItem key={c.label}>
            <Link href={c.href}>
              <AnimatedCard className={`rounded-2xl bg-surface border border-stroke/60 p-5 shadow-1 border-l-[3px] ${cardAccents[i]}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-dark-5 font-medium">{c.label}</p>
                    <p className="text-3xl font-bold text-dark mt-1">
                      {loaded ? <AnimatedNumber value={c.value} /> : <span className="skeleton inline-block w-10 h-8" />}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center text-dark-5">
                    {c.icon}
                  </div>
                </div>
              </AnimatedCard>
            </Link>
          </StaggerItem>
        ))}
      </StaggerContainer>

      <FadeIn delay={0.25}>
        <div className="rounded-2xl bg-surface border border-stroke/60 shadow-1 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-stroke/60">
            <h2 className="text-[15px] font-semibold text-dark">Recent Campaigns</h2>
            <Link href="/campaigns" className="text-[13px] text-primary hover:text-accent font-medium transition-colors">
              View all
            </Link>
          </div>

          {!loaded ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-dark-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
              </div>
              <p className="text-dark-5 text-sm mb-1">No campaigns yet</p>
              <Link href="/campaigns/new" className="text-[13px] text-primary font-medium hover:text-accent transition-colors">
                Create your first campaign
              </Link>
            </div>
          ) : (
            <div>
              {campaigns.map((c, i) => {
                const s = statusStyle[c.status] || statusStyle.DRAFT;
                return (
                  <Link
                    key={c.id}
                    href="/campaigns"
                    className={`flex items-center gap-4 px-6 py-3.5 hover:bg-surface-2/60 transition-colors ${
                      i < campaigns.length - 1 ? 'border-b border-stroke/40' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-dark truncate">{c.name}</p>
                      <p className="text-xs text-dark-6 mt-0.5">{c.message?.type || 'EMAIL'}</p>
                    </div>
                    <span className="text-xs text-dark-6 shrink-0">{timeAgo(c.createdAt)}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      {c.status === 'SENT' && c.total > 0 && (
                        <span className="text-xs text-dark-5 tabular-nums">{c.sent}/{c.total}</span>
                      )}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${s.bg} ${s.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {c.status}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </FadeIn>
    </AnimatedPage>
  );
}
