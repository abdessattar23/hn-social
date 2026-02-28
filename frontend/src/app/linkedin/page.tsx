'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AnimatedPage, TabTransition, StaggerContainer, StaggerItem } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Account = { id: string; type: string; name?: string; connection_params?: any };
type SearchResult = { items?: any[] };

export default function LinkedInPage() {
  useRequireAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [tab, setTab] = useState<'search' | 'post' | 'message'>('search');

  const [searchCategory, setSearchCategory] = useState<'people' | 'companies'>('people');
  const [keywords, setKeywords] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);

  const [chatId, setChatId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/unipile/accounts')
      .then((data: any) => {
        const linkedinAccounts = (Array.isArray(data) ? data : data.items || [])
          .filter((a: any) => a.type === 'LINKEDIN' || a.account_type === 'LINKEDIN');
        setAccounts(linkedinAccounts);
        if (linkedinAccounts.length) setSelectedAccount(linkedinAccounts[0].id);
      })
      .catch(() => {});
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSearching(true);
    setError('');
    setSearchResults(null);
    try {
      const result = await api.post('/linkedin/search', {
        accountId: selectedAccount, category: searchCategory, keywords, api: 'classic',
      });
      setSearchResults(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setPosting(true);
    setError('');
    setPostSuccess(false);
    try {
      await api.post('/linkedin/post', { accountId: selectedAccount, text: postText });
      setPostSuccess(true);
      setPostText('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  };

  const handleMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSending(true);
    setError('');
    setSendSuccess(false);
    try {
      await api.post('/linkedin/message', { accountId: selectedAccount, chatId, text: messageText });
      setSendSuccess(true);
      setMessageText('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const tabs = [
    { key: 'search' as const, label: 'Search' },
    { key: 'post' as const, label: 'Create Post' },
    { key: 'message' as const, label: 'Send Message' },
  ];

  const charRatio = postText.length / 3000;

  return (
    <AnimatedPage className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">LinkedIn</h1>
        <p className="text-sm text-dark-5">Search, post, and message on LinkedIn</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-surface rounded-2xl border border-stroke/60 p-5"
      >
        <label className="block text-sm font-medium text-dark-5 mb-2">LinkedIn Account</label>
        {accounts.length === 0 ? (
          <p className="text-dark-6 text-sm">No LinkedIn accounts connected. Go to Settings to connect one.</p>
        ) : (
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="w-full max-w-md border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.connection_params?.im?.display_name || a.id}
              </option>
            ))}
          </select>
        )}
      </motion.div>

      <div className="flex gap-1 bg-surface-2 rounded-xl p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(''); }}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key ? 'text-white' : 'text-dark-5 hover:text-dark'
            }`}
          >
            {tab === t.key && (
              <motion.div
                layoutId="linkedin-tab"
                className="absolute inset-0 bg-primary rounded-lg"
                transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <TabTransition activeKey={tab}>
        {tab === 'search' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-dark">Find People & Companies</h2>
            <p className="text-sm text-dark-5">Search LinkedIn for potential connections and leads.</p>
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex gap-3">
                <select
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value as any)}
                  className="border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200"
                >
                  <option value="people">People</option>
                  <option value="companies">Companies</option>
                </select>
                <input
                  type="text"
                  placeholder="Keywords..."
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="flex-1 border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200"
                />
                <motion.button
                  type="submit"
                  disabled={searching || !selectedAccount}
                  whileHover={searching ? {} : { scale: 1.03 }}
                  whileTap={searching ? {} : { scale: 0.97 }}
                  className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity"
                >
                  {searching ? 'Searching...' : 'Search'}
                </motion.button>
              </div>
            </form>

            {searchResults && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-dark-5">{(searchResults.items || []).length} result(s)</p>
                <StaggerContainer className="space-y-2 max-h-[600px] overflow-y-auto">
                  {(searchResults.items || []).map((item: any, i: number) => (
                    <StaggerItem key={i}>
                      <div className="bg-surface-2 border border-stroke/60 rounded-xl p-4 flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center text-primary text-sm font-bold shrink-0">
                          {(item.name || item.title || '?')[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-dark text-sm truncate">{item.name || item.title || 'Unknown'}</p>
                          <p className="text-dark-6 text-xs truncate">{item.headline || item.description || item.industry || ''}</p>
                          {item.location && <p className="text-dark-6 text-xs mt-1">{item.location}</p>}
                        </div>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>
            )}
          </div>
        )}

        {tab === 'post' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-dark">Share on LinkedIn</h2>
            <p className="text-sm text-dark-5">Create a post that will appear on your LinkedIn feed.</p>
            <form onSubmit={handlePost} className="space-y-4">
              <textarea
                placeholder="What do you want to share?"
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                rows={6}
                maxLength={3000}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200"
              />
              <div className="flex items-center justify-between">
                <span className={`text-xs transition-colors duration-300 ${charRatio > 0.9 ? 'text-red font-medium' : charRatio > 0.7 ? 'text-yellow-dark' : 'text-dark-6'}`}>
                  {postText.length}/3000
                </span>
                <motion.button
                  type="submit"
                  disabled={posting || !postText.trim() || !selectedAccount}
                  whileHover={posting ? {} : { scale: 1.03 }}
                  whileTap={posting ? {} : { scale: 0.97 }}
                  className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity"
                >
                  {posting ? 'Publishing...' : 'Publish'}
                </motion.button>
              </div>
            </form>
            <AnimatePresence>
              {postSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="bg-green-light-7 border border-green/20 text-green rounded-xl px-4 py-3 text-sm"
                >
                  Post published successfully!
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {tab === 'message' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-dark">Direct Message</h2>
            <p className="text-sm text-dark-5">Send a private message to a LinkedIn connection.</p>
            <form onSubmit={handleMessage} className="space-y-4">
              <input
                type="text"
                placeholder="Chat ID or Provider ID"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200"
              />
              <textarea
                placeholder="Your message..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200"
              />
              <motion.button
                type="submit"
                disabled={sending || !chatId || !messageText.trim() || !selectedAccount}
                whileHover={sending ? {} : { scale: 1.03 }}
                whileTap={sending ? {} : { scale: 0.97 }}
                className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity"
              >
                {sending ? 'Sending...' : 'Send Message'}
              </motion.button>
            </form>
            <AnimatePresence>
              {sendSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="bg-green-light-7 border border-green/20 text-green rounded-xl px-4 py-3 text-sm"
                >
                  Message sent successfully!
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </TabTransition>
    </AnimatedPage>
  );
}
