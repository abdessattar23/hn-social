'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { TagPills } from '@/components/tag-pills';
import { AnimatedPage, SpringIn } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Contact = { id: number; name: string; identifier: string };
type List = { id: number; name: string; type: string; tags: string[]; contacts: Contact[] };
type ChatAttendee = { id?: string; display_name?: string; name?: string; provider_id?: string };
type Chat = { id: string; name: string | null; provider_id?: string; attendees?: ChatAttendee[]; title?: string };

function chatDisplayName(c: Chat): string {
  // Use explicit name if available and meaningful
  if (c.name && c.name !== 'Chat' && !/^[A-Za-z0-9_-]{10,}$/.test(c.name)) return c.name;
  // Use chat title (group chats)
  if (c.title) return c.title;
  // Extract from attendees (LinkedIn, etc.)
  if (c.attendees?.length) {
    const names = c.attendees
      .map((a) => a.display_name || a.name || '')
      .filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  // WhatsApp phone number formatting
  const pid = c.provider_id || '';
  if (pid.includes('@s.whatsapp.net')) {
    return '+' + pid.replace('@s.whatsapp.net', '');
  }
  return c.name || c.id;
}

function isGroup(c: Chat): boolean {
  return (c.provider_id || '').includes('@g.us');
}

export default function ListDetailPage() {
  const { id } = useParams();
  const { authed } = useRequireAuth();
  const [list, setList] = useState<List | null>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [whatsappChats, setWhatsappChats] = useState<Chat[]>([]);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [showChatPicker, setShowChatPicker] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!authed) return;
    load();
    api.get('/lists').then((lists: any[]) => {
      const set = new Set<string>();
      lists.forEach((l) => (l.tags || []).forEach((t: string) => set.add(t)));
      setAllTags([...set].sort());
    }).catch(() => {});
  }, [authed, id]);

  const load = () => api.get(`/lists/${id}`).then(setList).catch(() => {});

  const updateTags = async (tags: string[]) => {
    await api.patch(`/lists/${id}/tags`, { tags });
    setList((prev) => prev ? { ...prev, tags } : prev);
    setAllTags((prev) => {
      const set = new Set(prev);
      tags.forEach((t) => set.add(t));
      return [...set].sort();
    });
  };

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setError('');
    try {
      await api.post(`/lists/${id}/contacts`, { name, identifier });
      setName('');
      setIdentifier('');
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to add contact');
    }
  };

  const removeContact = async (contactId: number) => {
    await api.del(`/lists/${id}/contacts/${contactId}`);
    load();
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const endpoint = list?.type === 'WHATSAPP' ? `/lists/${id}/import-whatsapp-csv` : `/lists/${id}/import-csv`;
      const result = await api.upload(endpoint, form);
      alert(`Imported ${result.imported} contacts`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to import CSV');
    }
    e.target.value = '';
  };

  const [chatFilter, setChatFilter] = useState<'groups' | 'contacts'>('groups');
  const [chatSearch, setChatSearch] = useState('');
  const [chatSort, setChatSort] = useState<'name' | 'recent'>('name');

  const loadChats = async () => {
    setLoadingChats(true);
    setError('');
    try {
      const endpoint = list?.type === 'LINKEDIN' ? '/unipile/linkedin/chats' : '/unipile/whatsapp/chats';
      const data = await api.get(endpoint);
      setWhatsappChats(data.items || []);
      setShowChatPicker(true);
      setChatSearch('');
    } catch (err: any) {
      const channel = list?.type === 'LINKEDIN' ? 'LinkedIn' : 'WhatsApp';
      setError(err.message || `Failed to load ${channel} chats. Make sure ${channel} is connected in Settings.`);
    } finally {
      setLoadingChats(false);
    }
  };

  const existingIdentifiers = new Set(list?.contacts.map((c) => c.identifier) || []);

  const isLinkedIn = list?.type === 'LINKEDIN';
  const filteredChats = whatsappChats
    .filter((c) => !existingIdentifiers.has(c.id))
    .filter((c) => isLinkedIn ? true : chatFilter === 'groups' ? isGroup(c) : !isGroup(c))
    .filter((c) => {
      if (!chatSearch.trim()) return true;
      const q = chatSearch.toLowerCase();
      return chatDisplayName(c).toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (chatSort === 'name') return chatDisplayName(a).localeCompare(chatDisplayName(b));
      return (b as any).timestamp?.localeCompare((a as any).timestamp) || 0;
    });

  const addSelectedChats = async () => {
    const chats = whatsappChats.filter((c) => selectedChats.has(c.id)).map((c) => ({ id: c.id, name: chatDisplayName(c) }));
    if (chats.length === 0) return;
    try {
      const endpoint = list?.type === 'LINKEDIN' ? `/lists/${id}/linkedin-chats` : `/lists/${id}/whatsapp-chats`;
      await api.post(endpoint, { chats });
      setShowChatPicker(false);
      setSelectedChats(new Set());
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to add chats');
    }
  };

  const toggleChat = (chatId: string) => {
    const next = new Set(selectedChats);
    next.has(chatId) ? next.delete(chatId) : next.add(chatId);
    setSelectedChats(next);
  };

  const toggleSelect = (cid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });
  };

  const toggleAll = () => {
    if (!list) return;
    if (selected.size === list.contacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(list.contacts.map((c) => c.id)));
    }
  };

  const bulkRemove = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map((cid) => api.del(`/lists/${id}/contacts/${cid}`)));
      setSelected(new Set());
      load();
    } catch {}
    setDeleting(false);
  };

  if (!authed || !list) return <div className="text-dark-5 text-sm p-4">Loading...</div>;

  return (
    <AnimatedPage>
      <a href="/lists" className="text-sm text-dark-5 hover:text-dark flex items-center gap-1 mb-4 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
        Back to Lists
      </a>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-dark">{list.name}</h1>
        <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${list.type === 'EMAIL' ? 'bg-blue-light-5 text-blue' : list.type === 'WHATSAPP' ? 'bg-green-light-7 text-green' : 'bg-linkedin-light text-linkedin'}`}>{list.type}</span>
        <span className="text-sm text-dark-5">{list.contacts.length} contacts</span>
      </div>

      <div className="mb-4">
        <TagPills
          tags={list.tags || []}
          editable
          allTags={allTags}
          onAdd={(tag) => updateTags([...(list.tags || []), tag])}
          onRemove={(tag) => updateTags((list.tags || []).filter((t) => t !== tag))}
        />
      </div>

      {error && <p className="text-red text-sm mb-4">{error}</p>}

      {/* Empty state */}
      {list.contacts.length === 0 && !showChatPicker && (
        <div className="rounded-2xl bg-surface p-8 shadow-1 mb-6 text-center">
          <p className="text-dark-5 mb-4">
            {list.type === 'EMAIL'
              ? 'Add email contacts to this list. You can add them one by one or import a CSV.'
              : list.type === 'WHATSAPP'
              ? 'Add WhatsApp groups to this list. Select from your connected groups or import a CSV.'
              : 'Add LinkedIn contacts to this list. Select from your connections or import a CSV.'}
          </p>
          <div className="flex gap-3 justify-center">
            <label className="bg-gray-2 text-dark-5 rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-3 transition-colors">
              Import CSV
              <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
            </label>
            {list.type === 'WHATSAPP' && (
              <button onClick={loadChats} disabled={loadingChats} className="bg-green text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition">
                {loadingChats ? 'Loading...' : 'Select WhatsApp Groups'}
              </button>
            )}
            {list.type === 'LINKEDIN' && (
              <button onClick={loadChats} disabled={loadingChats} className="bg-linkedin text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition">
                {loadingChats ? 'Loading...' : 'Select LinkedIn Connections'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action buttons when list has contacts */}
      {list.contacts.length > 0 && (
        <div className="flex gap-3 mb-6 mt-4 flex-wrap">
          <label className="bg-gray-2 text-dark-5 rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-3 transition-colors">
            Import CSV
            <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
          </label>
          {list.type === 'WHATSAPP' && (
<button onClick={loadChats} disabled={loadingChats} className="bg-green text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition">
            {loadingChats ? 'Loading...' : 'Select WhatsApp Groups'}
            </button>
          )}
          {list.type === 'LINKEDIN' && (
<button onClick={loadChats} disabled={loadingChats} className="bg-linkedin text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition">
            {loadingChats ? 'Loading...' : 'Select LinkedIn Connections'}
            </button>
          )}
        </div>
      )}

      {/* Chat picker */}
      {showChatPicker && (
        <div className="rounded-2xl bg-surface p-5 shadow-1 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm text-dark">{isLinkedIn ? 'Select LinkedIn Connections' : 'Select WhatsApp Chats'}</h3>
            <div className="flex gap-2">
              <button onClick={addSelectedChats} disabled={selectedChats.size === 0} className="bg-primary hover:bg-accent text-white rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50 transition">Add Selected ({selectedChats.size})</button>
              <button onClick={() => setShowChatPicker(false)} className="text-dark-5 hover:text-dark text-xs px-3 py-2 transition-colors">Cancel</button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            {!isLinkedIn && (
              <div className="flex gap-1">
                <button onClick={() => setChatFilter('groups')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${chatFilter === 'groups' ? 'bg-primary text-white' : 'bg-gray-2 text-dark-5 hover:bg-gray-3'}`}>
                  Groups ({whatsappChats.filter((c) => !existingIdentifiers.has(c.id) && isGroup(c)).length})
                </button>
                <button onClick={() => setChatFilter('contacts')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${chatFilter === 'contacts' ? 'bg-primary text-white' : 'bg-gray-2 text-dark-5 hover:bg-gray-3'}`}>
                  Contacts ({whatsappChats.filter((c) => !existingIdentifiers.has(c.id) && !isGroup(c)).length})
                </button>
              </div>
            )}
            <div className="flex-1" />
            <button onClick={() => {
              const allVisible = filteredChats.map((c) => c.id);
              const allSelected = allVisible.every((id) => selectedChats.has(id));
              const next = new Set(selectedChats);
              if (allSelected) { allVisible.forEach((id) => next.delete(id)); } else { allVisible.forEach((id) => next.add(id)); }
              setSelectedChats(next);
            }} className="px-3 py-1.5 text-xs text-dark-5 hover:text-dark border border-stroke rounded-lg transition-colors">
              {filteredChats.length > 0 && filteredChats.every((c) => selectedChats.has(c.id)) ? 'Deselect All' : 'Select All'}
            </button>
            <button onClick={() => setChatSort(chatSort === 'name' ? 'recent' : 'name')} className="px-3 py-1.5 text-xs text-dark-5 hover:text-dark border border-stroke rounded-lg transition-colors">
              Sort: {chatSort === 'name' ? 'A-Z' : 'Recent'}
            </button>
          </div>
          <input
            placeholder={isLinkedIn ? 'Search connections...' : 'Search chats...'}
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            className="w-full border border-stroke rounded-lg px-5 py-3 text-sm outline-none mb-3 transition focus:border-primary bg-surface-2"
          />
          <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
            {whatsappChats.length === 0 ? (
              <p className="text-dark-5 text-sm py-4 text-center">{isLinkedIn ? 'No LinkedIn connections found. Connect LinkedIn in Settings first.' : 'No WhatsApp chats found. Connect WhatsApp in Settings first.'}</p>
            ) : filteredChats.length === 0 ? (
              <p className="text-dark-6 text-sm py-4 text-center">{isLinkedIn ? 'No connections found.' : `No ${chatFilter} found.`}</p>
            ) : filteredChats.map((c) => (
              <label key={c.id} className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-primary/5 rounded-lg cursor-pointer text-sm transition-colors">
                <input type="checkbox" checked={selectedChats.has(c.id)} onChange={() => toggleChat(c.id)} className="accent-primary" />
                <span className="flex-1 text-dark">{chatDisplayName(c)}</span>
                {isGroup(c) && <span className="text-xs text-dark-6">Group</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Add single contact (email and LinkedIn lists) */}
      {(list.type === 'EMAIL' || list.type === 'LINKEDIN') && (
        <div className="rounded-2xl bg-surface p-5 shadow-1 mb-6">
          <h3 className="font-medium text-sm text-dark mb-3">Add Contact</h3>
          <form onSubmit={addContact} className="flex gap-3">
            <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="border border-stroke rounded-lg px-5 py-3 text-sm flex-1 outline-none transition focus:border-primary bg-surface-2" />
            <input placeholder={list.type === 'EMAIL' ? 'Email address' : 'LinkedIn profile URL or name'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required type={list.type === 'EMAIL' ? 'email' : 'text'} className="border border-stroke rounded-lg px-5 py-3 text-sm flex-1 outline-none transition focus:border-primary bg-surface-2" />
            <button type="submit" className="bg-primary hover:bg-accent text-white rounded-lg px-6 py-3 text-sm font-medium whitespace-nowrap transition">Add Contact</button>
          </form>
        </div>
      )}

      {/* Contacts table */}
      {list.contacts.length > 0 && (
        <div className="rounded-2xl bg-surface shadow-1 overflow-hidden border border-stroke/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-left">
                <th className="px-5 py-5 w-10">
                  <input
                    type="checkbox"
                    checked={list.contacts.length > 0 && selected.size === list.contacts.length}
                    onChange={toggleAll}
                    className="accent-primary w-4 h-4 cursor-pointer"
                  />
                </th>
                <th className="px-5 py-5 font-medium text-dark-5 text-xs uppercase tracking-wider">Name</th>
                <th className="px-5 py-5 font-medium text-dark-5 text-xs uppercase tracking-wider">{list.type === 'EMAIL' ? 'Email' : list.type === 'LINKEDIN' ? 'Profile URL' : 'Chat ID'}</th>
                <th className="px-5 py-5 font-medium text-dark-5 text-xs uppercase tracking-wider w-20"></th>
              </tr>
            </thead>
            <tbody>
              {list.contacts.map((c) => (
                <tr key={c.id} className="border-b border-stroke hover:bg-primary/5 transition-colors">
                  <td className="px-5 py-5">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="accent-primary w-4 h-4 cursor-pointer"
                    />
                  </td>
                  <td className="px-5 py-5 text-dark">{c.name || '—'}</td>
                  <td className="px-5 py-5 text-dark-5 font-mono text-xs">{c.identifier}</td>
                  <td className="px-5 py-5"><button onClick={() => removeContact(c.id)} className="text-red hover:text-red/80 text-xs font-medium transition-colors">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <SpringIn className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
              <span className="text-white text-sm font-medium">
                {selected.size} {selected.size === 1 ? 'contact' : 'contacts'} selected
              </span>
              <div className="w-px h-5 bg-surface/20" />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={bulkRemove}
                disabled={deleting}
                className="bg-red text-white rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {deleting ? 'Removing...' : 'Remove'}
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
