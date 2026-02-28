'use client';
import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { FilterBar } from '@/components/filter-bar';
import { TagPills } from '@/components/tag-pills';
import { SortableHeader, SortState, toggleSort, sortItems } from '@/components/sortable-header';
import { AnimatedPage, AnimatedCard, StaggerContainer, StaggerItem, SlideDown, SpringIn } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type ContactList = { id: number; name: string; type: string; contactCount: number; tags: string[]; createdAt: string };

const typeBadge = (t: string) => {
  if (t === 'EMAIL') return 'bg-blue-light-5 text-blue';
  if (t === 'WHATSAPP') return 'bg-green-light-7 text-green';
  return 'bg-linkedin-light text-linkedin';
};

export default function ListsPage() {
  const { authed } = useRequireAuth();
  const [lists, setLists] = useState<ContactList[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'EMAIL' | 'WHATSAPP' | 'LINKEDIN'>('EMAIL');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterType, setFilterType] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'createdAt', dir: 'desc' });

  useEffect(() => {
    if (!authed) return;
    load();
  }, [authed]);

  const load = () => api.get('/lists').then(setLists).catch(() => {});

  const allTags = useMemo(() => {
    const set = new Set<string>();
    lists.forEach((l) => (l.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [lists]);

  const filtered = useMemo(() => {
    const f = lists.filter((l) => {
      if (search && !l.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType && l.type !== filterType) return false;
      if (filterTags.length > 0 && !filterTags.some((t) => (l.tags || []).includes(t))) return false;
      return true;
    });
    return sortItems(f, sort, {
      name: (l) => l.name.toLowerCase(),
      type: (l) => l.type,
      contactCount: (l) => l.contactCount,
      createdAt: (l) => new Date(l.createdAt).getTime(),
    });
  }, [lists, search, filterType, filterTags, sort]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setCreating(true);
    try {
      const list = await api.post('/lists', { name, type });
      window.location.href = `/lists/${list.id}`;
    } catch (err: any) {
      setError(err.message || 'Failed to create list');
      setCreating(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this list?')) return;
    await api.del(`/lists/${id}`);
    load();
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    await Promise.allSettled([...selected].map((id) => api.del(`/lists/${id}`)));
    setSelected(new Set());
    load();
    setDeleting(false);
  };

  const startCampaign = () => {
    const ids = [...selected].join(',');
    window.location.href = `/campaigns/new?listIds=${ids}`;
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!authed) return null;

  return (
    <AnimatedPage className="pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Contact Lists</h1>
        <p className="text-sm text-dark-5">Organize and manage your audiences</p>
      </div>

      <SlideDown open={showForm}>
        <div className="rounded-2xl bg-surface p-6 shadow-1 mb-6 border border-stroke/60">
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark mb-1.5">List Name</label>
              <input
                placeholder="e.g. Newsletter Subscribers"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1.5">Type</label>
              <div className="flex gap-3">
                {(['EMAIL', 'WHATSAPP', 'LINKEDIN'] as const).map((t) => (
                  <label key={t} className={`flex-1 flex items-center gap-2 px-4 py-3 border rounded-xl cursor-pointer text-sm transition-all duration-200 ${type === t ? 'border-primary bg-primary/[0.04] font-medium text-primary' : 'border-stroke hover:border-gray-4'}`}>
                    <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="accent-primary" />
                    {t === 'EMAIL' ? 'Email' : t === 'WHATSAPP' ? 'WhatsApp' : 'LinkedIn'} List
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-red text-sm">{error}</p>}
            <motion.button
              type="submit"
              disabled={creating}
              whileHover={creating ? {} : { scale: 1.02 }}
              whileTap={creating ? {} : { scale: 0.98 }}
              className="w-full bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              {creating ? 'Creating...' : 'Create List'}
            </motion.button>
          </form>
        </div>
      </SlideDown>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        allTags={allTags}
        selectedTags={filterTags}
        onTagsChange={setFilterTags}
        typeOptions={['EMAIL', 'WHATSAPP', 'LINKEDIN']}
        selectedType={filterType}
        onTypeChange={setFilterType}
      >
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowForm(!showForm)}
          className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-opacity whitespace-nowrap"
        >
          {showForm ? 'Cancel' : 'New List'}
        </motion.button>
      </FilterBar>

      {lists.length === 0 && !showForm ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60"
        >
          <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </div>
          <p className="text-dark font-semibold text-lg mb-1">No contact lists yet</p>
          <p className="text-dark-5 text-sm mb-6">Create your first list to start organizing contacts for outreach.</p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowForm(true)}
            className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-opacity"
          >
            Create your first list
          </motion.button>
        </motion.div>
      ) : lists.length > 0 && (
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((l) => (
            <StaggerItem key={l.id}>
              <AnimatedCard
                className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 hover:border-stroke/50"
                onClick={() => window.location.href = `/lists/${l.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-dark truncate">{l.name}</h3>
                    <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${typeBadge(l.type)}`}>
                      {l.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(l.id); }}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-primary w-4 h-4 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-dark-5 mb-3">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                    </svg>
                    {l.contactCount} contacts
                  </span>
                  <span>{new Date(l.createdAt).toLocaleDateString()}</span>
                </div>

                <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                  <TagPills tags={l.tags || []} />
                  <button onClick={(e) => { e.stopPropagation(); remove(l.id); }} className="text-red hover:text-red/80 text-xs font-medium transition-colors">
                    Delete
                  </button>
                </div>
              </AnimatedCard>
            </StaggerItem>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-dark-5 text-sm">No lists match your filters.</div>
          )}
        </StaggerContainer>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <SpringIn className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
              <span className="text-white text-sm font-medium">
                {selected.size} {selected.size === 1 ? 'list' : 'lists'} selected
              </span>
              <div className="w-px h-5 bg-surface/20" />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startCampaign}
                className="bg-primary hover:bg-accent text-white rounded-xl px-4 py-2 text-sm font-medium transition-opacity"
              >
                Start Campaign
              </motion.button>
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
