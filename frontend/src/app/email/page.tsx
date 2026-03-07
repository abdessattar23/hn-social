'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AnimatedPage } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Account = { id: string; type: string; name?: string; connection_params?: any };
type Folder = { id: string; name: string; unread_count?: number };
type Email = {
  id: string;
  subject?: string;
  from_attendee?: { display_name?: string; identifier?: string };
  to_attendees?: { display_name?: string; identifier?: string }[];
  body?: string;
  body_plain?: string;
  date?: string;
  read?: boolean;
  has_attachments?: boolean;
  attachments?: any[];
  provider_id?: string;
};

const EMAIL_TYPES = ['MAIL', 'GOOGLE', 'GOOGLE_OAUTH', 'IMAP', 'OUTLOOK'];

const DEFAULT_FOLDERS = [
  { id: 'INBOX', name: 'Inbox', icon: 'inbox' },
  { id: 'SENT', name: 'Sent', icon: 'sent' },
  { id: 'DRAFT', name: 'Drafts', icon: 'draft' },
  { id: 'TRASH', name: 'Trash', icon: 'trash' },
  { id: 'SPAM', name: 'Spam', icon: 'spam' },
];

const FolderIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'sent':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
        </svg>
      );
    case 'draft':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
        </svg>
      );
    case 'trash':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      );
    case 'spam':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
        </svg>
      );
  }
};

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 86_400_000;

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function senderInitials(email?: Email) {
  const name = email?.from_attendee?.display_name || email?.from_attendee?.identifier || '?';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function EmailPage() {
  useRequireAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('INBOX');
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);

  useEffect(() => {
    api.get('/unipile/accounts')
      .then((data: any) => {
        const emailAccounts = (Array.isArray(data) ? data : data.items || [])
          .filter((a: any) => EMAIL_TYPES.includes(a.type));
        setAccounts(emailAccounts);
        if (emailAccounts.length) setSelectedAccount(emailAccounts[0].id);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!selectedAccount) return;
    api.get(`/email/folders?accountId=${selectedAccount}`)
      .then((data: any) => setFolders(Array.isArray(data) ? data : data.items || []))
      .catch(() => setFolders([]));
  }, [selectedAccount]);

  const loadEmails = useCallback(async (folder: string, acct: string) => {
    if (!acct) return;
    setLoadingEmails(true);
    setError('');
    setSelectedEmail(null);
    try {
      const data = await api.get(`/email?accountId=${acct}&folder=${encodeURIComponent(folder)}&limit=20`);
      setEmails(data.items || data || []);
      setCursor(data.cursor || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load emails');
      setEmails([]);
    } finally {
      setLoadingEmails(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccount) loadEmails(selectedFolder, selectedAccount);
  }, [selectedAccount, selectedFolder, loadEmails]);

  const handleLoadMore = async () => {
    if (!cursor || !selectedAccount || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get(`/email?accountId=${selectedAccount}&folder=${encodeURIComponent(selectedFolder)}&limit=20&cursor=${cursor}`);
      setEmails((prev) => [...prev, ...(data.items || data || [])]);
      setCursor(data.cursor || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const openEmail = async (email: Email) => {
    setSelectedEmail(email);
    setShowReply(false);
    setReplySuccess(false);
    if (!email.body) {
      setLoadingDetail(true);
      try {
        const detail = await api.get(`/email/${email.id}?accountId=${selectedAccount}`);
        setSelectedEmail(detail);
      } catch {
        // keep the partial data
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return;
    setSending(true);
    setError('');
    setSendSuccess(false);
    try {
      await api.post('/email/send', {
        accountId: selectedAccount,
        to: [{ display_name: composeTo.split('@')[0], identifier: composeTo.trim() }],
        subject: composeSubject,
        body: composeBody,
      });
      setSendSuccess(true);
      setTimeout(() => {
        setShowCompose(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setSendSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !selectedEmail || !replyBody.trim()) return;
    setReplying(true);
    setError('');
    setReplySuccess(false);
    try {
      await api.post('/email/reply', {
        accountId: selectedAccount,
        emailId: selectedEmail.provider_id || selectedEmail.id,
        body: replyBody,
      });
      setReplySuccess(true);
      setReplyBody('');
      setTimeout(() => {
        setShowReply(false);
        setReplySuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleDelete = async (emailId: string) => {
    if (!confirm('Move this email to trash?')) return;
    try {
      await api.del(`/email/${emailId}?accountId=${selectedAccount}`);
      setEmails((prev) => prev.filter((e) => e.id !== emailId));
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete email');
    }
  };

  const handleDisconnect = async () => {
    if (!selectedAccount) return;
    const account = accounts.find((a) => a.id === selectedAccount);
    const name = account?.name || account?.connection_params?.im?.display_name || account?.id;
    if (!confirm(`Are you sure you want to disconnect "${name}"?`)) return;

    try {
      await api.del(`/unipile/accounts/${selectedAccount}`);
      const data = await api.get('/unipile/accounts');
      const emailAccounts = (Array.isArray(data) ? data : data.items || [])
        .filter((a: any) => EMAIL_TYPES.includes(a.type));
      setAccounts(emailAccounts);
      if (emailAccounts.length > 0) {
        setSelectedAccount(emailAccounts[0].id);
      } else {
        setSelectedAccount('');
        setEmails([]);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect account');
    }
  };

  const displayFolders = folders.length > 0
    ? folders
    : DEFAULT_FOLDERS.map((f) => ({ id: f.id, name: f.name }));

  const folderMeta = (folderId: string) =>
    DEFAULT_FOLDERS.find(
      (f) => f.id === folderId || folderId.toUpperCase().includes(f.id)
    ) || DEFAULT_FOLDERS[0];

  return (
    <AnimatedPage className="pb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-dark tracking-tight">Email</h1>
          <p className="text-sm text-dark-5">Manage your email inbox</p>
        </div>
        {selectedAccount && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => { setShowCompose(true); setSendSuccess(false); }}
            className="flex items-center gap-2 bg-primary hover:bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Compose
          </motion.button>
        )}
      </div>

      {/* Account Selector */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-surface rounded-2xl border border-stroke/60 p-4 mb-5"
      >
        {accounts.length === 0 ? (
          <p className="text-dark-6 text-sm">No email accounts connected. Go to <a href="/settings" className="text-primary hover:underline">Settings</a> to connect one.</p>
        ) : (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-dark-5 shrink-0">Account</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="flex-1 max-w-md border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.connection_params?.im?.display_name || a.id} ({a.type})
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadEmails(selectedFolder, selectedAccount)}
                className="p-2 text-dark-5 hover:text-dark hover:bg-surface-2 rounded-lg transition-colors flex items-center justify-center"
                title="Refresh Inbox"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
              </button>
              <button
                onClick={handleDisconnect}
                className="p-2 text-dark-5 hover:text-red hover:bg-red/10 rounded-lg transition-colors flex items-center justify-center"
                title="Disconnect Account"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between"
          >
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedAccount && (
        <div className="flex gap-5 min-h-[600px]">
          {/* Folder Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="w-48 shrink-0"
          >
            <div className="bg-surface rounded-2xl border border-stroke/60 p-3 sticky top-20">
              <p className="text-xs font-semibold text-dark-5 uppercase tracking-wider px-2 mb-2">Folders</p>
              <div className="space-y-0.5">
                {displayFolders.map((folder) => {
                  const meta = folderMeta(folder.id);
                  const active = selectedFolder === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${active
                        ? 'bg-primary/10 text-primary'
                        : 'text-dark-5 hover:text-dark hover:bg-surface-2'
                        }`}
                    >
                      <FolderIcon type={meta.icon} />
                      <span className="truncate">{folder.name}</span>
                      {(folder as any).unread_count > 0 && (
                        <span className="ml-auto text-[10px] bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center font-bold">
                          {(folder as any).unread_count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* Email List */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={`${selectedEmail ? 'w-80 shrink-0' : 'flex-1'} transition-all duration-300`}
          >
            <div className="bg-surface rounded-2xl border border-stroke/60 overflow-hidden h-full flex flex-col">
              <div className="px-4 py-3 border-b border-stroke/60 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-dark">
                  {displayFolders.find((f) => f.id === selectedFolder)?.name || selectedFolder}
                </h2>
                <span className="text-xs text-dark-6">{emails.length} emails</span>
              </div>

              {loadingEmails ? (
                <div className="p-6 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="w-9 h-9 rounded-full bg-surface-3" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-surface-3 rounded w-1/3" />
                        <div className="h-3 bg-surface-3 rounded w-2/3" />
                        <div className="h-2.5 bg-surface-3 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : emails.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-16">
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto text-dark-6 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.844a2.25 2.25 0 0 1 1.183-1.981l7.209-3.882a2.25 2.25 0 0 1 2.134 0l7.209 3.882a2.25 2.25 0 0 1 1.183 1.98V19.5Z" />
                    </svg>
                    <p className="text-dark-5 text-sm">No emails in this folder</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-stroke/40">
                  {emails.map((email, i) => {
                    const isActive = selectedEmail?.id === email.id;
                    const isUnread = email.read === false;
                    return (
                      <motion.button
                        key={email.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        onClick={() => openEmail(email)}
                        className={`w-full text-left px-4 py-3 flex gap-3 transition-all duration-150 ${isActive
                          ? 'bg-primary/[0.06] border-l-2 border-l-primary'
                          : 'hover:bg-surface-2 border-l-2 border-l-transparent'
                          }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isUnread ? 'bg-primary/10 text-primary' : 'bg-surface-3 text-dark-5'
                          }`}>
                          {senderInitials(email)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm truncate ${isUnread ? 'font-semibold text-dark' : 'font-medium text-dark-3'}`}>
                              {email.from_attendee?.display_name || email.from_attendee?.identifier || 'Unknown'}
                            </p>
                            <span className="text-[11px] text-dark-6 shrink-0">{formatDate(email.date)}</span>
                          </div>
                          <p className={`text-xs truncate mt-0.5 ${isUnread ? 'font-medium text-dark-3' : 'text-dark-5'}`}>
                            {email.subject || '(no subject)'}
                          </p>
                          {!selectedEmail && (
                            <p className="text-[11px] text-dark-6 truncate mt-0.5">
                              {email.body_plain ? email.body_plain.slice(0, 100) : email.body ? stripHtml(email.body).slice(0, 100) : ''}
                            </p>
                          )}
                        </div>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                        )}
                      </motion.button>
                    );
                  })}
                  {cursor && (
                    <div className="p-3 flex justify-center">
                      <button
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="text-xs text-primary hover:text-accent font-medium disabled:opacity-50 transition-colors"
                      >
                        {loadingMore ? 'Loading...' : 'Load more'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>

          {/* Email Detail */}
          <AnimatePresence mode="wait">
            {selectedEmail && (
              <motion.div
                key={selectedEmail.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="flex-1 min-w-0"
              >
                <div className="bg-surface rounded-2xl border border-stroke/60 h-full flex flex-col overflow-hidden">
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-stroke/60">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-semibold text-dark leading-snug">
                          {selectedEmail.subject || '(no subject)'}
                        </h3>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                            {senderInitials(selectedEmail)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-dark truncate">
                              {selectedEmail.from_attendee?.display_name || selectedEmail.from_attendee?.identifier || 'Unknown'}
                            </p>
                            <p className="text-xs text-dark-6 truncate">
                              {selectedEmail.from_attendee?.identifier}
                              {selectedEmail.to_attendees?.length ? (
                                <span> → {selectedEmail.to_attendees.map((t) => t.display_name || t.identifier).join(', ')}</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-dark-6">{formatDate(selectedEmail.date)}</span>
                        <button
                          onClick={() => handleDelete(selectedEmail.id)}
                          className="text-dark-6 hover:text-red transition-colors p-1"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setSelectedEmail(null)}
                          className="text-dark-5 hover:text-dark transition-colors p-1"
                          title="Close"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto px-5 py-4">
                    {loadingDetail ? (
                      <div className="space-y-3 animate-pulse">
                        <div className="h-3 bg-surface-3 rounded w-full" />
                        <div className="h-3 bg-surface-3 rounded w-5/6" />
                        <div className="h-3 bg-surface-3 rounded w-4/6" />
                        <div className="h-3 bg-surface-3 rounded w-full" />
                        <div className="h-3 bg-surface-3 rounded w-3/4" />
                      </div>
                    ) : selectedEmail.body ? (
                      <div
                        className="text-sm text-dark leading-relaxed prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: selectedEmail.body }}
                      />
                    ) : selectedEmail.body_plain ? (
                      <pre className="text-sm text-dark leading-relaxed whitespace-pre-wrap font-sans">
                        {selectedEmail.body_plain}
                      </pre>
                    ) : (
                      <p className="text-dark-5 text-sm italic">No content available</p>
                    )}

                    {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-stroke/60">
                        <p className="text-xs font-semibold text-dark-5 uppercase tracking-wider mb-2">
                          Attachments ({selectedEmail.attachments.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedEmail.attachments.map((att: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 bg-surface-2 border border-stroke rounded-lg px-3 py-2 text-xs text-dark-5">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                              </svg>
                              <span className="truncate max-w-[150px]">{att.name || att.filename || `Attachment ${i + 1}`}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reply */}
                  <div className="px-5 py-3 border-t border-stroke/60">
                    {!showReply ? (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { setShowReply(true); setReplySuccess(false); }}
                        className="flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                        </svg>
                        Reply
                      </motion.button>
                    ) : (
                      <form onSubmit={handleReply} className="space-y-3">
                        <textarea
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          rows={4}
                          placeholder="Write your reply..."
                          className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200"
                          autoFocus
                        />
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => { setShowReply(false); setReplyBody(''); }}
                            className="text-xs text-dark-5 hover:text-dark transition-colors"
                          >
                            Cancel
                          </button>
                          <div className="flex items-center gap-2">
                            <AnimatePresence>
                              {replySuccess && (
                                <motion.span
                                  initial={{ opacity: 0, x: 10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0 }}
                                  className="text-green text-xs font-medium"
                                >
                                  Sent!
                                </motion.span>
                              )}
                            </AnimatePresence>
                            <motion.button
                              type="submit"
                              disabled={replying || !replyBody.trim()}
                              whileHover={replying ? {} : { scale: 1.03 }}
                              whileTap={replying ? {} : { scale: 0.97 }}
                              className="bg-primary hover:bg-accent text-white rounded-xl px-5 py-2 text-xs font-medium disabled:opacity-50 transition-all duration-200"
                            >
                              {replying ? 'Sending...' : 'Send Reply'}
                            </motion.button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Compose Modal */}
      <AnimatePresence>
        {showCompose && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
            onClick={() => !sending && setShowCompose(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface rounded-2xl p-6 max-w-xl w-full shadow-xl border border-stroke max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-dark">New Email</h3>
                <button
                  onClick={() => !sending && setShowCompose(false)}
                  className="text-dark-5 hover:text-dark transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSend} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-dark mb-1.5">To</label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="recipient@example.com"
                    className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark mb-1.5">Subject</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Email subject"
                    className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark mb-1.5">Message</label>
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    rows={8}
                    placeholder="Write your message..."
                    className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary resize-y placeholder:text-dark-6 transition-all duration-200"
                    required
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => !sending && setShowCompose(false)}
                    className="px-4 py-2 text-sm font-medium text-dark-5 hover:text-dark rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    type="submit"
                    disabled={sending || !composeTo || !composeSubject || !composeBody}
                    whileHover={sending ? {} : { scale: 1.03 }}
                    whileTap={sending ? {} : { scale: 0.97 }}
                    className="flex items-center gap-2 bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50 transition-all duration-200"
                  >
                    {sending ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Sending...
                      </>
                    ) : sendSuccess ? (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Sent!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                        </svg>
                        Send
                      </>
                    )}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedPage>
  );
}
