'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

type Account = { id: string; type: string; name?: string; connection_params?: any };
type Batch = {
  id: number; name: string; status: string; account_id: string;
  note_template: string; message_template: string;
  total: number; invited: number; invite_failed: number;
  messaged: number; message_failed: number;
  created_at: string; contacts?: BatchContact[];
};
type BatchContact = {
  id: number; provider_id: string | null; public_identifier: string | null;
  name: string; headline: string; company: string; profile_url: string;
  invite_status: string; invite_error: string | null;
  message_status: string | null; message_error: string | null;
};

const statusConfig: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-gray-2', text: 'text-dark-5' },
  RESOLVING: { bg: 'bg-purple-100', text: 'text-purple-700' },
  INVITING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark' },
  INVITED: { bg: 'bg-blue-light-5', text: 'text-blue' },
  MESSAGING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark' },
  DONE: { bg: 'bg-green-light-7', text: 'text-green' },
};

const inviteStatusConfig: Record<string, string> = {
  PENDING: 'text-dark-5',
  SENT: 'text-green',
  FAILED: 'text-red',
  ALREADY_CONNECTED: 'text-blue',
};

export default function LinkedInBatches({ accounts, selectedAccount }: {
  accounts: Account[];
  selectedAccount: string;
}) {
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [batchName, setBatchName] = useState('');
  const [noteTemplate, setNoteTemplate] = useState('');
  const [creating, setCreating] = useState(false);

  const [messageTemplate, setMessageTemplate] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const loadBatches = useCallback(() => {
    api.get('/linkedin/batches').then(setBatches).catch((err: any) => setError(err.message));
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  useEffect(() => {
    const anyBusy = batches.some((b) => b.status === 'RESOLVING' || b.status === 'INVITING' || b.status === 'MESSAGING');
    if (!anyBusy || view !== 'list') return;
    const timer = setInterval(loadBatches, 4000);
    return () => clearInterval(timer);
  }, [batches, view, loadBatches]);

  const isProcessing = selectedBatch?.status === 'INVITING' || selectedBatch?.status === 'MESSAGING' || selectedBatch?.status === 'RESOLVING';

  useEffect(() => {
    if (!selectedBatch || !isProcessing) return;
    const timer = setInterval(() => {
      api.get(`/linkedin/batches/${selectedBatch.id}`)
        .then((b: Batch) => {
          setSelectedBatch(b);
          const still = b.status === 'INVITING' || b.status === 'MESSAGING' || b.status === 'RESOLVING';
          if (!still) loadBatches();
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedBatch, isProcessing, loadBatches]);

  const openDetail = async (id: number) => {
    setLoading(true); setError('');
    try {
      const b = await api.get(`/linkedin/batches/${id}`);
      setSelectedBatch(b);
      setMessageTemplate(b.message_template || '');
      setView('detail');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!csvFile || !batchName || !selectedAccount) return;
    setCreating(true); setError('');
    try {
      const form = new FormData();
      form.append('file', csvFile);
      form.append('name', batchName);
      form.append('accountId', selectedAccount);
      form.append('noteTemplate', noteTemplate);
      const batch = await api.upload('/linkedin/batches', form);
      setBatchName(''); setNoteTemplate(''); setCsvFile(null);
      loadBatches();
      setSelectedBatch(batch);
      setView('detail');
    } catch (err: any) { setError(err.message); }
    finally { setCreating(false); }
  };

  const handleResolve = async () => {
    if (!selectedBatch) return;
    setActionLoading('resolve'); setError('');
    try {
      await api.post(`/linkedin/batches/${selectedBatch.id}/resolve`, { accountId: selectedBatch.account_id });
      const b = await api.get(`/linkedin/batches/${selectedBatch.id}`);
      setSelectedBatch(b);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(''); }
  };

  const handleInvite = async () => {
    if (!selectedBatch) return;
    setActionLoading('invite'); setError('');
    try {
      await api.post(`/linkedin/batches/${selectedBatch.id}/invite`);
      const b = await api.get(`/linkedin/batches/${selectedBatch.id}`);
      setSelectedBatch(b);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(''); }
  };

  const handleMessage = async () => {
    if (!selectedBatch || !messageTemplate) return;
    setActionLoading('message'); setError('');
    try {
      await api.post(`/linkedin/batches/${selectedBatch.id}/message`, { messageTemplate });
      const b = await api.get(`/linkedin/batches/${selectedBatch.id}`);
      setSelectedBatch(b);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(''); }
  };

  const handleExport = async () => {
    if (!selectedBatch) return;
    setActionLoading('export'); setError('');
    try {
      const result = await api.post(`/linkedin/batches/${selectedBatch.id}/export-list`);
      alert(`Exported ${result.contactsExported} contacts to list "${result.listName}"`);
    } catch (err: any) { setError(err.message); }
    finally { setActionLoading(''); }
  };

  const handleStop = async () => {
    if (!selectedBatch) return;
    try {
      await api.post(`/linkedin/batches/${selectedBatch.id}/stop`);
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this batch and all its contacts?')) return;
    try {
      await api.del(`/linkedin/batches/${id}`);
      loadBatches();
      if (selectedBatch?.id === id) { setSelectedBatch(null); setView('list'); }
    } catch (err: any) { setError(err.message); }
  };

  const insertVar = (v: string, setter: (fn: (prev: string) => string) => void) => {
    setter((prev) => prev + `{{${v}}}`);
  };

  const sc = (status: string) => statusConfig[status] || statusConfig.DRAFT;

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:text-red/70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-dark">Outreach Batches</h2>
              <p className="text-sm text-dark-5">Upload a CSV, send invitations, then follow up with messages.</p>
            </div>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setView('create')}
              className="bg-primary hover:bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-colors">
              New Batch
            </motion.button>
          </div>

          {batches.length === 0 ? (
            <div className="text-center py-12 text-dark-5 text-sm">No batches yet. Create one to start outreach.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {batches.map((b) => {
                const isBusy = b.status === 'RESOLVING' || b.status === 'INVITING' || b.status === 'MESSAGING';
                const progress = b.status === 'INVITING' ? b.invited + b.invite_failed
                  : b.status === 'MESSAGING' ? b.messaged + b.message_failed : 0;
                const pct = isBusy && b.total > 0 ? Math.round((progress / b.total) * 100) : 0;
                return (
                  <motion.div key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-surface-2 border border-stroke/60 rounded-xl p-4 cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => openDetail(b.id)}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-dark text-sm truncate">{b.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${sc(b.status).bg} ${sc(b.status).text}`}>
                        {isBusy && (
                          <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                        {b.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-dark-5 mb-2">
                      <span>{b.total} contacts</span>
                      {b.invited > 0 && <span>{b.invited} invited</span>}
                      {b.messaged > 0 && <span>{b.messaged} messaged</span>}
                    </div>
                    {isBusy && b.total > 0 && (
                      <div className="h-1 bg-stroke rounded-full overflow-hidden mb-2">
                        <motion.div className="h-full bg-primary rounded-full"
                          animate={{ width: b.status === 'RESOLVING' ? '50%' : `${pct}%` }}
                          transition={{ duration: 0.5 }} />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-dark-6">{new Date(b.created_at).toLocaleDateString()}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                        className="text-red hover:text-red/80 text-xs font-medium transition-colors">Delete</button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CREATE VIEW */}
      {view === 'create' && (
        <div className="space-y-4">
          <button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-dark-5 hover:text-dark transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back to Batches
          </button>
          <h2 className="text-lg font-semibold text-dark">Create Outreach Batch</h2>

          <div>
            <label className="block text-sm font-medium text-dark mb-1.5">Batch Name</label>
            <input type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. AI Hackathon Winners Outreach"
              className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200" />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1.5">Upload CSV</label>
            <p className="text-xs text-dark-5 mb-2">CSV should contain a column with LinkedIn profile identifiers (profile URL, public ID, or provider ID). Extra columns like name, headline, company are used automatically.</p>
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-stroke hover:border-primary/40 rounded-xl px-4 py-6 cursor-pointer transition-colors">
              <input type="file" accept=".csv" className="hidden" onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
              <svg className="w-5 h-5 text-dark-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
              <span className="text-sm text-dark-5">{csvFile ? csvFile.name : 'Choose CSV file...'}</span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-dark">Invitation Note <span className="text-dark-6 font-normal">(optional, max 300 chars)</span></label>
              <div className="flex gap-1.5">
                {['name', 'company'].map((v) => (
                  <button key={v} type="button" onClick={() => insertVar(v, setNoteTemplate)}
                    className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 rounded px-1.5 py-0.5 font-medium transition-colors">
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={noteTemplate} onChange={(e) => setNoteTemplate(e.target.value)} maxLength={300} rows={3}
              placeholder="Hi {{name}}, I'd love to connect..."
              className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200" />
            <p className={`text-xs mt-1 ${noteTemplate.length > 270 ? 'text-red font-medium' : 'text-dark-6'}`}>{noteTemplate.length}/300</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setView('list')} className="px-4 py-2 text-sm text-dark-5 hover:text-dark rounded-xl transition-colors">Cancel</button>
            <motion.button whileHover={creating ? {} : { scale: 1.03 }} whileTap={creating ? {} : { scale: 0.97 }}
              onClick={handleCreate} disabled={creating || !csvFile || !batchName || !selectedAccount}
              className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50 transition-all duration-200">
              {creating ? 'Creating...' : 'Create Batch'}
            </motion.button>
          </div>
        </div>
      )}

      {/* DETAIL VIEW */}
      {view === 'detail' && selectedBatch && (
        <div className="space-y-4">
          <button onClick={() => { setView('list'); setSelectedBatch(null); loadBatches(); }}
            className="flex items-center gap-1 text-sm text-dark-5 hover:text-dark transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            Back to Batches
          </button>

          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-dark">{selectedBatch.name}</h2>
              <p className="text-xs text-dark-5 mt-0.5">{new Date(selectedBatch.created_at).toLocaleString()}</p>
            </div>
            <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${sc(selectedBatch.status).bg} ${sc(selectedBatch.status).text}`}>
              {selectedBatch.status}
            </span>
          </div>

          {/* Counters */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { label: 'Total', value: selectedBatch.total, cls: 'text-dark' },
              { label: 'Invited', value: selectedBatch.invited, cls: 'text-green' },
              { label: 'Invite Failed', value: selectedBatch.invite_failed, cls: 'text-red' },
              { label: 'Messaged', value: selectedBatch.messaged, cls: 'text-blue' },
              { label: 'Msg Failed', value: selectedBatch.message_failed, cls: 'text-red' },
            ].map((s) => (
              <div key={s.label} className="bg-surface-2 rounded-lg px-3 py-2 text-center">
                <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-[10px] text-dark-5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {selectedBatch.status === 'DRAFT' && (
              <>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handleResolve} disabled={actionLoading === 'resolve'}
                  className="bg-surface-2 hover:bg-surface-3 border border-stroke text-dark rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50 transition-all">
                  {actionLoading === 'resolve' ? 'Starting...' : 'Resolve Profiles'}
                </motion.button>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handleInvite} disabled={!!actionLoading}
                  className="bg-primary hover:bg-accent text-white rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50 transition-all">
                  {actionLoading === 'invite' ? 'Starting...' : 'Send Invitations'}
                </motion.button>
              </>
            )}
            {(selectedBatch.status === 'INVITING' || selectedBatch.status === 'MESSAGING' || selectedBatch.status === 'RESOLVING') && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleStop}
                className="bg-red/10 text-red hover:bg-red/20 rounded-xl px-4 py-2 text-xs font-semibold transition-colors">
                Emergency Stop
              </motion.button>
            )}
            {(selectedBatch.status === 'INVITED' || selectedBatch.status === 'DONE') && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleExport} disabled={actionLoading === 'export'}
                className="bg-surface-2 hover:bg-surface-3 border border-stroke text-dark rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-50 transition-all">
                {actionLoading === 'export' ? 'Exporting...' : 'Export to Campaign List'}
              </motion.button>
            )}
          </div>

          {/* Follow-up messaging (for INVITED status) */}
          {selectedBatch.status === 'INVITED' && (
            <div className="bg-surface-2 border border-stroke/60 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-dark">Follow-up Message</h3>
              <p className="text-xs text-dark-5">Send a message to all contacts. Some may fail if the invitation wasn't accepted.</p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-dark-5 font-medium">Message Template</span>
                  <div className="flex gap-1.5">
                    {['name', 'company'].map((v) => (
                      <button key={v} type="button" onClick={() => insertVar(v, setMessageTemplate)}
                        className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 rounded px-1.5 py-0.5 font-medium transition-colors">
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} maxLength={5000} rows={3}
                  placeholder="Hi {{name}}, thanks for connecting! I wanted to..."
                  className="w-full border border-stroke bg-surface rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200" />
              </div>
              <motion.button whileHover={actionLoading === 'message' ? {} : { scale: 1.03 }} whileTap={actionLoading === 'message' ? {} : { scale: 0.97 }}
                onClick={handleMessage} disabled={!!actionLoading || !messageTemplate.trim()}
                className="bg-primary hover:bg-accent text-white rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-all">
                {actionLoading === 'message' ? 'Starting...' : `Send Messages to ${selectedBatch.total} Contacts`}
              </motion.button>
            </div>
          )}

          {/* Progress bar */}
          {isProcessing && selectedBatch.total > 0 && (() => {
            let label = '';
            let done = 0;
            if (selectedBatch.status === 'RESOLVING') {
              const resolved = (selectedBatch.contacts || []).filter((c: BatchContact) => c.provider_id || c.invite_status === 'ALREADY_CONNECTED').length;
              label = 'Resolving profiles';
              done = resolved;
            } else if (selectedBatch.status === 'INVITING') {
              label = 'Sending invitations';
              done = selectedBatch.invited + selectedBatch.invite_failed;
            } else {
              label = 'Sending messages';
              done = selectedBatch.messaged + selectedBatch.message_failed;
            }
            const pct = Math.round((done / selectedBatch.total) * 100);
            return (
              <div className="bg-surface-2 border border-stroke/60 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-dark font-medium flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {label}...
                  </span>
                  <span className="text-dark-5">{done}/{selectedBatch.total} ({pct}%)</span>
                </div>
                <div className="h-2 bg-stroke rounded-full overflow-hidden">
                  <motion.div className="h-full bg-primary rounded-full"
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5 }} />
                </div>
                <p className="text-[11px] text-dark-6">You can safely leave this page. Processing continues in the background.</p>
              </div>
            );
          })()}

          {/* Contacts list */}
          <div>
            <h3 className="text-sm font-semibold text-dark mb-2">Contacts ({selectedBatch.contacts?.length || 0})</h3>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {(selectedBatch.contacts || []).map((c) => (
                <div key={c.id} className="bg-surface-2 border border-stroke/40 rounded-lg px-3 py-2 flex items-center gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    {(c.name || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-dark text-xs truncate">{c.name || c.public_identifier || c.provider_id?.slice(0, 15) || '?'}</p>
                    {c.headline && <p className="text-dark-6 text-[11px] truncate">{c.headline}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px]">
                    <span className={`font-medium ${inviteStatusConfig[c.invite_status] || 'text-dark-5'}`}>
                      {c.invite_status === 'ALREADY_CONNECTED' ? 'Connected' : c.invite_status}
                    </span>
                    {c.message_status && (
                      <>
                        <span className="text-dark-6">|</span>
                        <span className={`font-medium ${c.message_status === 'SENT' ? 'text-green' : c.message_status === 'FAILED' ? 'text-red' : 'text-dark-5'}`}>
                          Msg: {c.message_status}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {(!selectedBatch.contacts || selectedBatch.contacts.length === 0) && (
                <p className="text-dark-5 text-xs text-center py-4">No contacts in this batch.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <svg className="w-6 h-6 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}
    </div>
  );
}
