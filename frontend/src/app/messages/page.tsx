'use client';
import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import Link from 'next/link';
import { FilterBar } from '@/components/filter-bar';
import { TagPills } from '@/components/tag-pills';
import { RichTextEditor } from '@/components/rich-text-editor';
import { SortableHeader, SortState, toggleSort, sortItems } from '@/components/sortable-header';
import { AnimatedPage, AnimatedCard, StaggerContainer, StaggerItem, SlideDown, SpringIn } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Msg = { id: number; name: string; type: string; subject: string; tags: string[]; createdAt: string };

const typeBadge = (t: string) => {
  if (t === 'EMAIL') return 'bg-blue-light-5 text-blue';
  if (t === 'WHATSAPP') return 'bg-green-light-7 text-green';
  return 'bg-linkedin-light text-linkedin';
};

export default function MessagesPage() {
  const { authed } = useRequireAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [type, setType] = useState<'EMAIL' | 'WHATSAPP' | 'LINKEDIN'>('EMAIL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showForm, setShowForm] = useState(false);
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

  const load = () => api.get('/messages').then(setMessages).catch(() => {});

  const allTags = useMemo(() => {
    const set = new Set<string>();
    messages.forEach((m) => (m.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [messages]);

  const filtered = useMemo(() => {
    const f = messages.filter((m) => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType && m.type !== filterType) return false;
      if (filterTags.length > 0 && !filterTags.some((t) => (m.tags || []).includes(t))) return false;
      return true;
    });
    return sortItems(f, sort, {
      name: (m) => m.name.toLowerCase(),
      type: (m) => m.type,
      subject: (m) => (m.subject || '').toLowerCase(),
      createdAt: (m) => new Date(m.createdAt).getTime(),
    });
  }, [messages, search, filterType, filterTags, sort]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/messages', { name, type, subject: type === 'EMAIL' ? subject : undefined, body });
      setName(''); setSubject(''); setBody('');
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to create template');
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    await api.del(`/messages/${id}`);
    load();
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
    await Promise.allSettled([...selected].map((id) => api.del(`/messages/${id}`)));
    setSelected(new Set());
    load();
    setDeleting(false);
  };

  if (!authed) return null;

  return (
    <AnimatedPage className="pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Templates</h1>
        <p className="text-sm text-dark-5">Craft reusable message templates</p>
      </div>

      {error && <p className="text-red text-sm mb-4">{error}</p>}

      <SlideDown open={showForm}>
        <div className="rounded-2xl bg-surface p-6 shadow-1 mb-6 border border-stroke/60">
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} required className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2" />
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface transition-all duration-200 focus:border-primary">
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="LINKEDIN">LinkedIn</option>
              </select>
            </div>
            {type === 'EMAIL' && (
              <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2" />
            )}
            {type === 'EMAIL' ? (
              <RichTextEditor content={body} onChange={setBody} placeholder="Email body..." />
            ) : (
              <textarea placeholder="Message text (emojis supported)..." value={body} onChange={(e) => setBody(e.target.value)} required rows={8} className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2" />
            )}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors"
            >
              Create Template
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
          className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap"
        >
          {showForm ? 'Cancel' : 'New Template'}
        </motion.button>
      </FilterBar>

      {messages.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <p className="text-dark font-semibold text-lg mb-1">No templates yet</p>
          <p className="text-dark-5 text-sm">Create reusable message templates for your outreach campaigns.</p>
        </motion.div>
      ) : (
        <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <StaggerItem key={m.id}>
              <AnimatedCard className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 hover:border-stroke/50">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <Link href={`/messages/${m.id}`} className="font-semibold text-dark hover:text-primary transition-colors truncate block">
                      {m.name}
                    </Link>
                    <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${typeBadge(m.type)}`}>
                      {m.type}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                    className="accent-primary w-4 h-4 cursor-pointer mt-1"
                  />
                </div>

                {m.subject && (
                  <p className="text-xs text-dark-5 mb-2 truncate">
                    <span className="text-dark-6">Subject:</span> {m.subject}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-dark-5 mb-3">
                  <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                </div>

                <div className="flex items-center justify-between">
                  <TagPills tags={m.tags || []} />
                  <button onClick={() => remove(m.id)} className="text-red hover:text-red/80 text-xs font-medium transition-colors">
                    Delete
                  </button>
                </div>
              </AnimatedCard>
            </StaggerItem>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-dark-5 text-sm">No templates match your filters.</div>
          )}
        </StaggerContainer>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <SpringIn className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
              <span className="text-white text-sm font-medium">
                {selected.size} {selected.size === 1 ? 'template' : 'templates'} selected
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
