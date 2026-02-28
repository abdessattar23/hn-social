'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import Link from 'next/link';
import { FilterBar } from '@/components/filter-bar';
import { TagPills } from '@/components/tag-pills';
import { SortState, toggleSort, sortItems } from '@/components/sortable-header';
import { AnimatedPage, AnimatedCard, StaggerContainer, StaggerItem, SpringIn } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Campaign = {
  id: number; name: string; status: string;
  total: number; sent: number; failed: number;
  tags: string[];
  message: { name: string; type: string };
  createdAt: string;
  scheduledAt: string | null;
};

const statusConfig: Record<string, { bg: string; text: string; dot: string; pulse?: boolean }> = {
  DRAFT: { bg: 'bg-gray-2', text: 'text-dark-5', dot: 'bg-dark-5' },
  SCHEDULED: { bg: 'bg-blue-light-5', text: 'text-blue', dot: 'bg-blue' },
  SENDING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark', dot: 'bg-yellow-dark', pulse: true },
  SENT: { bg: 'bg-green-light-7', text: 'text-green', dot: 'bg-green' },
  FAILED: { bg: 'bg-red-light-6', text: 'text-red', dot: 'bg-red' },
};

export default function CampaignsPage() {
  const { authed } = useRequireAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [editingTagsId, setEditingTagsId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'createdAt', dir: 'desc' });
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authed) return;
    load();
  }, [authed]);

  useEffect(() => {
    const needsPoll = campaigns.some((c) => c.status === 'SENDING' || c.status === 'SCHEDULED');
    if (!needsPoll) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [campaigns]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditingTagsId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const load = () => api.get('/campaigns').then(setCampaigns).catch(() => {});

  const allTags = useMemo(() => {
    const set = new Set<string>();
    campaigns.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [campaigns]);

  const filtered = useMemo(() => {
    const f = campaigns.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (filterTags.length > 0 && !filterTags.some((t) => (c.tags || []).includes(t))) return false;
      return true;
    });
    return sortItems(f, sort, {
      name: (c) => c.name.toLowerCase(),
      template: (c) => (c.message?.name || '').toLowerCase(),
      status: (c) => c.status,
      progress: (c) => c.total > 0 ? c.sent / c.total : 0,
      createdAt: (c) => new Date(c.createdAt).getTime(),
    });
  }, [campaigns, search, filterStatus, filterTags, sort]);

  const remove = async (id: number) => {
    if (!confirm('Delete this campaign?')) return;
    await api.del(`/campaigns/${id}`);
    load();
  };

  const cancel = async (id: number) => {
    if (!confirm('Cancel this scheduled campaign?')) return;
    await api.post(`/campaigns/${id}/cancel`);
    load();
  };

  const updateCampaignTags = async (id: number, tags: string[]) => {
    await api.patch(`/campaigns/${id}/tags`, { tags });
    setCampaigns((prev) => prev.map((c) => c.id === id ? { ...c, tags } : c));
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    await Promise.allSettled([...selected].map((id) => api.del(`/campaigns/${id}`)));
    setSelected(new Set());
    load();
    setDeleting(false);
  };

  if (!authed) return null;

  return (
    <AnimatedPage className="pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Campaigns</h1>
        <p className="text-sm text-dark-5">Manage your outreach campaigns</p>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        allTags={allTags}
        selectedTags={filterTags}
        onTagsChange={setFilterTags}
        statusOptions={['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED']}
        selectedStatus={filterStatus}
        onStatusChange={setFilterStatus}
      >
        <Link href="/campaigns/new">
          <motion.span
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="inline-block bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-opacity whitespace-nowrap"
          >
            New Campaign
          </motion.span>
        </Link>
      </FilterBar>

      {campaigns.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </div>
          <p className="text-dark font-semibold text-lg mb-1">No campaigns yet</p>
          <p className="text-dark-5 text-sm">Launch your first outreach campaign to start connecting with contacts.</p>
        </motion.div>
      ) : (
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const sc = statusConfig[c.status] || statusConfig.DRAFT;
            const progress = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0;

            return (
              <StaggerItem key={c.id}>
                <AnimatedCard className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 hover:border-stroke/50">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-dark truncate">{c.name}</h3>
                      <p className="text-xs text-dark-5 mt-0.5 truncate">{c.message?.name}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="accent-primary w-4 h-4 cursor-pointer mt-1"
                    />
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${sc.bg} ${sc.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${sc.pulse ? 'animate-[pulse-dot_1.5s_ease-in-out_infinite]' : ''}`} />
                      {c.status}
                    </span>
                    {c.status === 'SCHEDULED' && c.scheduledAt && (
                      <span className="text-[11px] text-dark-5">
                        {new Date(c.scheduledAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {c.total > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-dark-5 mb-1">
                        <span>{c.sent} / {c.total} sent</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1 bg-stroke rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
                        />
                      </div>
                      {c.failed > 0 && (
                        <span className="text-red text-[11px] mt-1 block">{c.failed} failed</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-dark-5 mb-3">
                    <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>

                  <div className="flex items-center justify-between relative">
                    {editingTagsId === c.id ? (
                      <div ref={popoverRef} className="absolute bottom-full left-0 mb-2 z-50 bg-surface rounded-xl shadow-lg border border-stroke p-3 min-w-[200px]">
                        <TagPills
                          tags={c.tags || []}
                          editable
                          allTags={allTags}
                          onAdd={(tag) => updateCampaignTags(c.id, [...(c.tags || []), tag])}
                          onRemove={(tag) => updateCampaignTags(c.id, (c.tags || []).filter((t) => t !== tag))}
                        />
                      </div>
                    ) : (
                      <div onClick={() => setEditingTagsId(c.id)} className="cursor-pointer min-h-[24px]">
                        <TagPills tags={c.tags || []} />
                      </div>
                    )}
                    <div className="flex gap-2">
                      {c.status === 'SCHEDULED' && (
                        <button onClick={() => cancel(c.id)} className="text-yellow-dark hover:text-yellow-dark/80 text-xs font-medium transition-colors">Cancel</button>
                      )}
                      <button onClick={() => remove(c.id)} className="text-red hover:text-red/80 text-xs font-medium transition-colors">Delete</button>
                    </div>
                  </div>
                </AnimatedCard>
              </StaggerItem>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-dark-5 text-sm">No campaigns match your filters.</div>
          )}
        </StaggerContainer>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <SpringIn className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
              <span className="text-white text-sm font-medium">
                {selected.size} {selected.size === 1 ? 'campaign' : 'campaigns'} selected
              </span>
              <div className="w-px h-5 bg-surface/20" />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={bulkDelete}
                disabled={deleting}
                className="bg-red text-white rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </motion.button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-white/60 hover:text-white text-sm transition-colors ml-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </SpringIn>
        )}
      </AnimatePresence>
    </AnimatedPage>
  );
}
