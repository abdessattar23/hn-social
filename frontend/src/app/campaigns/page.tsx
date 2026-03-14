'use client';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
  STOPPED: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
};

export default function CampaignsPage() {
  const { authed } = useRequireAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [editingTagsId, setEditingTagsId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'createdAt', dir: 'desc' });
  const [loadError, setLoadError] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Live logs for sending campaigns
  type LogEntry = { timestamp: string; level: string; message: string };
  const [campaignLogs, setCampaignLogs] = useState<Record<number, LogEntry[]>>({});
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!authed) return;
    load();
  }, [authed]);

  useEffect(() => {
    const sendingCampaigns = campaigns.filter((c) => c.status === 'SENDING' || c.status === 'SCHEDULED');
    if (sendingCampaigns.length === 0) {
      if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; }
      return;
    }
    const pollAll = () => {
      load();
      sendingCampaigns.filter(c => c.status === 'SENDING').forEach((c) => {
        api.get(`/campaigns/${c.id}/logs`)
          .then((d: any) => {
            setCampaignLogs(prev => ({ ...prev, [c.id]: d.logs || [] }));
            setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          })
          .catch(() => { });
      });
    };
    pollAll();
    logPollRef.current = setInterval(pollAll, 1500);
    return () => { if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; } };
  }, [campaigns.map(c => `${c.id}:${c.status}`).join(',')]);

  // Auto-expand log for first sending campaign
  useEffect(() => {
    const sending = campaigns.find(c => c.status === 'SENDING');
    if (sending && expandedLogId == null) setExpandedLogId(sending.id);
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

  const load = () => api.get('/campaigns').then(setCampaigns).catch((err: any) => setLoadError(err.message || 'Failed to load campaigns'));

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

  const stopCampaign = async (id: number) => {
    setStoppingId(id);
    try {
      await api.post(`/campaigns/${id}/stop`);
      load();
    } catch (err: any) { setLoadError(err.message || 'Failed to stop campaign'); }
    setStoppingId(null);
    setShowStopConfirm(null);
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

  const exportFailed = async (id: number, name: string) => {
    try {
      const blob = await api.downloadBlob(`/campaigns/${id}/export-failed`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}-failed.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to export');
    }
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

      {loadError && (
        <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between">
          <span>{loadError}</span>
          <button onClick={() => setLoadError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        allTags={allTags}
        selectedTags={filterTags}
        onTagsChange={setFilterTags}
        statusOptions={['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'STOPPED']}
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
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-red text-[11px]">{c.failed} failed</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); exportFailed(c.id, c.name); }}
                            className="text-[11px] text-primary hover:text-accent font-medium transition-colors underline underline-offset-2"
                          >
                            Export failed
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live Terminal Logs */}
                  {(c.status === 'SENDING' || (campaignLogs[c.id]?.length ?? 0) > 0) && (
                    <div className="mb-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedLogId(expandedLogId === c.id ? null : c.id); }}
                        className="text-xs text-dark-5 hover:text-primary flex items-center gap-1 transition-colors mb-2"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedLogId === c.id ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        Dispatch Log ({campaignLogs[c.id]?.length || 0} entries)
                      </button>
                      {expandedLogId === c.id && (
                        <div className="rounded-xl overflow-hidden border border-stroke/60">
                          <div className="bg-[#1a1a2e] px-4 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-red/80" />
                                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                                <span className="w-2.5 h-2.5 rounded-full bg-green/80" />
                              </div>
                              <span className="text-gray-400 text-[10px] font-mono ml-1">dispatch.log</span>
                            </div>
                            {c.status === 'SENDING' && (
                              <span className="text-green text-[10px] font-mono animate-pulse">● LIVE</span>
                            )}
                          </div>
                          <div className="bg-[#16213e] max-h-[200px] overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
                            {(campaignLogs[c.id] || []).map((log, i) => {
                              const time = new Date(log.timestamp).toLocaleTimeString();
                              const colors: Record<string, string> = {
                                info: 'text-blue-300',
                                warn: 'text-yellow-300',
                                error: 'text-red-400',
                                success: 'text-green-400',
                              };
                              return (
                                <div key={i} className="flex gap-2">
                                  <span className="text-gray-500 shrink-0">{time}</span>
                                  <span className={colors[log.level] || 'text-gray-300'}>{log.message}</span>
                                </div>
                              );
                            })}
                            <div ref={expandedLogId === c.id ? logEndRef : null} />
                          </div>
                        </div>
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
                      {c.status === 'SENDING' && (
                        <button
                          onClick={() => setShowStopConfirm(c.id)}
                          disabled={stoppingId === c.id}
                          className="bg-red/10 text-red hover:bg-red/20 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {stoppingId === c.id ? 'Stopping...' : 'Emergency Stop'}
                        </button>
                      )}
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
        {showStopConfirm != null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
            onClick={() => setShowStopConfirm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface rounded-2xl p-6 max-w-md w-full shadow-xl border border-stroke"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-dark">Emergency Stop</h3>
                  <p className="text-sm text-dark-5">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-dark-5 mb-6">
                Are you sure? This will immediately stop sending to all remaining contacts in this campaign.
                Messages already sent cannot be recalled.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowStopConfirm(null)}
                  className="px-4 py-2 text-sm font-medium text-dark-5 hover:text-dark rounded-xl transition-colors"
                >
                  Keep Sending
                </button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => stopCampaign(showStopConfirm)}
                  disabled={stoppingId === showStopConfirm}
                  className="bg-red hover:bg-red/90 text-white rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-opacity"
                >
                  {stoppingId === showStopConfirm ? 'Stopping...' : 'Stop Campaign Now'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
