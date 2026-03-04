'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AnimatedPage, TabTransition } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';
import LinkedInBatches from '@/components/linkedin-batches';

type Account = { id: string; type: string; name?: string; connection_params?: any };
type SearchResult = { items?: any[]; paging?: { total_count?: number; start?: number; page_count?: number }; cursor?: string };
type FieldDef = { key: string; label: string };
type InviteTarget = { providerId: string; name: string };
type InviteResult = { providerId: string; name?: string; status: string; error?: string };

const FIELDS_BY_CATEGORY: Record<string, FieldDef[]> = {
  posts: [
    { key: 'author_name', label: 'Author Name' },
    { key: 'author_profile_id', label: 'Author Profile ID' },
    { key: 'author_headline', label: 'Author Headline' },
    { key: 'author_is_company', label: 'Author Is Company' },
    { key: 'post_url', label: 'Post URL' },
    { key: 'post_date', label: 'Post Date' },
    { key: 'post_text', label: 'Post Text' },
    { key: 'reactions', label: 'Reactions' },
    { key: 'comments', label: 'Comments' },
    { key: 'reposts', label: 'Reposts' },
    { key: 'impressions', label: 'Impressions' },
  ],
  people: [
    { key: 'name', label: 'Full Name' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'profile_url', label: 'Profile URL' },
    { key: 'headline', label: 'Headline' },
    { key: 'location', label: 'Location' },
    { key: 'network_distance', label: 'Network Distance' },
    { key: 'current_company', label: 'Current Company' },
    { key: 'current_role', label: 'Current Role' },
  ],
  companies: [
    { key: 'name', label: 'Company Name' },
    { key: 'company_id', label: 'Company ID' },
    { key: 'profile_url', label: 'Profile URL' },
    { key: 'industry', label: 'Industry' },
    { key: 'location', label: 'Location' },
    { key: 'headcount', label: 'Headcount' },
    { key: 'followers', label: 'Followers' },
    { key: 'job_offers', label: 'Job Offers' },
    { key: 'summary', label: 'Summary' },
  ],
};

const QUICK_SEARCHES = [
  { label: 'AI Hackathon Winners', keywords: 'AI hackathon winner', authorKeywords: '' },
  { label: 'Best AI Hackathon', keywords: 'best AI hackathon', authorKeywords: '' },
  { label: 'GenAI Hackathon', keywords: 'generative AI hackathon award', authorKeywords: '' },
];

function getInviteTarget(item: any, category: string): InviteTarget | null {
  if (category === 'people' && item.id) {
    return { providerId: item.id, name: item.name || 'Unknown' };
  }
  if (category === 'posts' && item.author?.public_identifier) {
    return { providerId: item.author.public_identifier, name: item.author.name || 'Unknown' };
  }
  return null;
}

export default function LinkedInPage() {
  useRequireAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [tab, setTab] = useState<'search' | 'post' | 'message' | 'batches'>('search');

  const [searchCategory, setSearchCategory] = useState<'people' | 'companies' | 'posts'>('people');
  const [keywords, setKeywords] = useState('');
  const [allItems, setAllItems] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [sortBy, setSortBy] = useState<'relevance' | 'date'>('relevance');
  const [datePosted, setDatePosted] = useState<'' | 'past_24h' | 'past_week' | 'past_month'>('');
  const [contentType, setContentType] = useState<'' | 'images' | 'videos' | 'documents'>('');
  const [authorKeywords, setAuthorKeywords] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportSelectedFields, setExportSelectedFields] = useState<Set<string>>(new Set());
  const [exportScope, setExportScope] = useState<'page' | 'all'>('page');
  const [exportLimit, setExportLimit] = useState('');
  const [exporting, setExporting] = useState(false);

  const [selectedForInvite, setSelectedForInvite] = useState<Set<string>>(new Set());
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResults, setInviteResults] = useState<InviteResult[] | null>(null);

  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);

  const [chatId, setChatId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [error, setError] = useState('');

  const canInvite = searchCategory === 'people' || searchCategory === 'posts';
  const availableFields = useMemo(() => FIELDS_BY_CATEGORY[searchCategory] || [], [searchCategory]);

  const inviteTargets = useMemo(() => {
    const map = new Map<string, InviteTarget>();
    for (const item of allItems) {
      const target = getInviteTarget(item, searchCategory);
      if (target) map.set(target.providerId, target);
    }
    return map;
  }, [allItems, searchCategory]);

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

  const openExportModal = () => {
    setExportSelectedFields(new Set(availableFields.map((f) => f.key)));
    setExportScope('page');
    setExportLimit('');
    setShowExportModal(true);
  };

  const toggleField = (key: string) => {
    setExportSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAllFields = () => setExportSelectedFields(new Set(availableFields.map((f) => f.key)));
  const deselectAllFields = () => setExportSelectedFields(new Set());
  const allFieldsSelected = exportSelectedFields.size === availableFields.length;
  const noFieldsSelected = exportSelectedFields.size === 0;

  const toggleInviteSelection = (providerId: string) => {
    setSelectedForInvite((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId); else next.add(providerId);
      return next;
    });
  };

  const selectAllForInvite = () => setSelectedForInvite(new Set(inviteTargets.keys()));
  const deselectAllForInvite = () => setSelectedForInvite(new Set());

  const openInviteModal = (targets?: InviteTarget[]) => {
    if (targets) {
      setSelectedForInvite(new Set(targets.map((t) => t.providerId)));
    }
    setInviteMessage('');
    setInviteResults(null);
    setShowInviteModal(true);
  };

  const handleSingleInvite = (item: any) => {
    const target = getInviteTarget(item, searchCategory);
    if (target) openInviteModal([target]);
  };

  const handleBulkInvite = async () => {
    if (!selectedAccount || selectedForInvite.size === 0) return;
    setInviting(true);
    setError('');
    setInviteResults(null);
    try {
      const invites = [...selectedForInvite]
        .map((id) => inviteTargets.get(id))
        .filter(Boolean) as InviteTarget[];

      if (invites.length === 1) {
        await api.post('/linkedin/invite', {
          accountId: selectedAccount,
          providerId: invites[0].providerId,
          message: inviteMessage || undefined,
        });
        setInviteResults([{ providerId: invites[0].providerId, name: invites[0].name, status: 'SENT' }]);
      } else {
        const result = await api.post('/linkedin/invite/bulk', {
          accountId: selectedAccount,
          invites: invites.map((i) => ({ providerId: i.providerId, name: i.name })),
          message: inviteMessage || undefined,
        });
        setInviteResults(result.results || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send invitations');
    } finally {
      setInviting(false);
    }
  };

  const buildSearchParams = useCallback((overrides?: Record<string, any>) => {
    const params: Record<string, any> = {
      accountId: selectedAccount,
      category: searchCategory,
      keywords,
      api: 'classic',
      ...overrides,
    };
    if (searchCategory === 'posts') {
      if (sortBy) params.sort_by = sortBy;
      if (datePosted) params.date_posted = datePosted;
      if (contentType) params.content_type = contentType;
      if (authorKeywords.trim()) params.author = { keywords: authorKeywords.trim() };
    }
    return params;
  }, [selectedAccount, searchCategory, keywords, sortBy, datePosted, contentType, authorKeywords]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSearching(true);
    setError('');
    setAllItems([]);
    setCursor(null);
    setTotalCount(null);
    setHasSearched(true);
    setSelectedForInvite(new Set());
    try {
      const result: SearchResult = await api.post('/linkedin/search', buildSearchParams());
      setAllItems(result.items || []);
      setTotalCount(result.paging?.total_count ?? null);
      setCursor(result.cursor || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleLoadMore = async () => {
    if (!cursor || !selectedAccount || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result: SearchResult = await api.post('/linkedin/search', buildSearchParams({ cursor }));
      setAllItems((prev) => [...prev, ...(result.items || [])]);
      setCursor(result.cursor || null);
      if (result.paging?.total_count != null) setTotalCount(result.paging.total_count);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleQuickSearch = (qs: typeof QUICK_SEARCHES[0]) => {
    setSearchCategory('posts');
    setKeywords(qs.keywords);
    setAuthorKeywords(qs.authorKeywords);
    setSortBy('date');
    setDatePosted('past_month');
  };

  const handleExport = async () => {
    if (!selectedAccount || noFieldsSelected) return;
    setExporting(true);
    setError('');
    try {
      const fields = [...exportSelectedFields];
      const maxResults = exportLimit ? parseInt(exportLimit, 10) : undefined;
      const endpoint = exportScope === 'all' ? '/linkedin/search/export-all-csv' : '/linkedin/search/export-csv';
      const blob = await api.downloadBlob(endpoint, {
        ...buildSearchParams(),
        exportFields: fields,
        exportMaxResults: maxResults && maxResults > 0 ? maxResults : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `linkedin-${searchCategory}-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to export');
    } finally {
      setExporting(false);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setPosting(true); setError(''); setPostSuccess(false);
    try {
      await api.post('/linkedin/post', { accountId: selectedAccount, text: postText });
      setPostSuccess(true); setPostText('');
    } catch (err: any) { setError(err.message); }
    finally { setPosting(false); }
  };

  const handleMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSending(true); setError(''); setSendSuccess(false);
    try {
      await api.post('/linkedin/message', { accountId: selectedAccount, chatId, text: messageText });
      setSendSuccess(true); setMessageText('');
    } catch (err: any) { setError(err.message); }
    finally { setSending(false); }
  };

  const tabs = [
    { key: 'search' as const, label: 'Search' },
    { key: 'post' as const, label: 'Create Post' },
    { key: 'message' as const, label: 'Send Message' },
    { key: 'batches' as const, label: 'Batches' },
  ];

  const charRatio = postText.length / 3000;
  const hasMore = !!cursor;

  const connectionBadge = (distance: string | undefined, pending: boolean | undefined) => {
    if (distance === 'DISTANCE_1') return { label: '1st', cls: 'bg-green-light-7 text-green border-green/20', connected: true };
    if (pending) return { label: 'Pending', cls: 'bg-yellow-light-4 text-yellow-dark border-yellow-dark/20', connected: false };
    if (distance === 'DISTANCE_2') return { label: '2nd', cls: 'bg-blue-light-5 text-blue border-blue/20', connected: false };
    if (distance === 'DISTANCE_3') return { label: '3rd', cls: 'bg-surface-3 text-dark-5 border-stroke', connected: false };
    if (distance === 'OUT_OF_NETWORK') return { label: 'Out of network', cls: 'bg-surface-3 text-dark-6 border-stroke', connected: false };
    return null;
  };

  const renderPostResult = (item: any) => {
    const target = getInviteTarget(item, 'posts');
    return (
      <div className="bg-surface-2 border border-stroke/60 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          {target && (
            <input type="checkbox" checked={selectedForInvite.has(target.providerId)}
              onChange={() => toggleInviteSelection(target.providerId)}
              className="accent-primary w-4 h-4 mt-1.5 cursor-pointer shrink-0" />
          )}
          <div className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-primary text-xs font-bold shrink-0">
            {(item.author?.name || '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-dark text-sm truncate">{item.author?.name || 'Unknown Author'}</p>
            <p className="text-dark-6 text-xs truncate">{item.author?.headline || ''}</p>
            {item.date && <p className="text-dark-6 text-[11px] mt-0.5">{item.date}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {target && (
              <button onClick={() => handleSingleInvite(item)}
                className="text-primary hover:text-accent text-xs font-medium transition-colors">
                Invite
              </button>
            )}
            {item.share_url && (
              <a href={item.share_url} target="_blank" rel="noopener noreferrer"
                className="text-dark-5 hover:text-dark text-xs font-medium transition-colors">
                View
              </a>
            )}
          </div>
        </div>
        {item.text && (
          <p className="text-dark text-sm leading-relaxed line-clamp-4 whitespace-pre-wrap">{item.text}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-dark-5">
          {item.reaction_counter != null && <span>{item.reaction_counter} reactions</span>}
          {item.comment_counter != null && <span>{item.comment_counter} comments</span>}
          {item.repost_counter != null && item.repost_counter > 0 && <span>{item.repost_counter} reposts</span>}
        </div>
      </div>
    );
  };

  const renderPeopleCompanyResult = (item: any) => {
    const target = searchCategory === 'people' ? getInviteTarget(item, 'people') : null;
    const badge = searchCategory === 'people' ? connectionBadge(item.network_distance, item.pending_invitation) : null;
    const isConnected = badge?.connected || false;
    const isPending = !!item.pending_invitation;
    const canSendInvite = target && !isConnected && !isPending;

    return (
      <div className={`bg-surface-2 border rounded-xl p-4 flex items-start gap-3 ${isConnected ? 'border-green/20' : 'border-stroke/60'}`}>
        {target && !isConnected && !isPending && (
          <input type="checkbox" checked={selectedForInvite.has(target.providerId)}
            onChange={() => toggleInviteSelection(target.providerId)}
            className="accent-primary w-4 h-4 mt-1.5 cursor-pointer shrink-0" />
        )}
        <div className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center text-primary text-sm font-bold shrink-0">
          {(item.name || item.title || '?')[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-dark text-sm truncate">{item.name || item.title || 'Unknown'}</p>
            {badge && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </div>
          <p className="text-dark-6 text-xs truncate">{item.headline || item.description || item.industry || ''}</p>
          {item.location && <p className="text-dark-6 text-xs mt-1">{item.location}</p>}
        </div>
        <div className="shrink-0">
          {isConnected && (
            <span className="text-green text-xs font-medium">Connected</span>
          )}
          {isPending && !isConnected && (
            <span className="text-yellow-dark text-xs font-medium">Pending</span>
          )}
          {canSendInvite && (
            <button onClick={() => handleSingleInvite(item)}
              className="text-primary hover:text-accent text-xs font-medium transition-colors">
              Invite
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <AnimatedPage className="space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">LinkedIn</h1>
        <p className="text-sm text-dark-5">Search, post, and message on LinkedIn</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-surface rounded-2xl border border-stroke/60 p-5">
        <label className="block text-sm font-medium text-dark-5 mb-2">LinkedIn Account</label>
        {accounts.length === 0 ? (
          <p className="text-dark-6 text-sm">No LinkedIn accounts connected. Go to Settings to connect one.</p>
        ) : (
          <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
            className="w-full max-w-md border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name || a.connection_params?.im?.display_name || a.id}</option>
            ))}
          </select>
        )}
      </motion.div>

      <div className="flex gap-1 bg-surface-2 rounded-xl p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setError(''); }}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'text-white' : 'text-dark-5 hover:text-dark'}`}>
            {tab === t.key && (
              <motion.div layoutId="linkedin-tab" className="absolute inset-0 bg-primary rounded-lg"
                transition={{ type: 'spring', stiffness: 350, damping: 30 }} />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm">{error}</motion.div>
        )}
      </AnimatePresence>

      <TabTransition activeKey={tab}>
        {tab === 'search' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-dark">
                {searchCategory === 'posts' ? 'Search Posts' : searchCategory === 'companies' ? 'Find Companies' : 'Find People'}
              </h2>
              <p className="text-sm text-dark-5">
                {searchCategory === 'posts' ? 'Discover LinkedIn posts and their authors.'
                  : searchCategory === 'companies' ? 'Search LinkedIn for companies.'
                  : 'Search LinkedIn for potential connections and leads.'}
              </p>
            </div>

            {searchCategory === 'posts' && (
              <div>
                <p className="text-xs text-dark-5 mb-2 font-medium">Quick Searches</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SEARCHES.map((qs) => (
                    <motion.button key={qs.label} type="button" onClick={() => handleQuickSearch(qs)}
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      className="bg-primary/10 text-primary hover:bg-primary/20 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
                      {qs.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSearch} className="space-y-3">
              <div className="flex gap-3">
                <select value={searchCategory} onChange={(e) => { setSearchCategory(e.target.value as any); setSelectedForInvite(new Set()); }}
                  className="border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200">
                  <option value="people">People</option>
                  <option value="companies">Companies</option>
                  <option value="posts">Posts</option>
                </select>
                <input type="text" placeholder="Keywords..." value={keywords} onChange={(e) => setKeywords(e.target.value)}
                  className="flex-1 border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200" />
                <motion.button type="submit" disabled={searching || !selectedAccount}
                  whileHover={searching ? {} : { scale: 1.03 }} whileTap={searching ? {} : { scale: 0.97 }}
                  className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity">
                  {searching ? 'Searching...' : 'Search'}
                </motion.button>
              </div>
              <AnimatePresence>
                {searchCategory === 'posts' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                      <div>
                        <label className="block text-xs text-dark-5 mb-1 font-medium">Sort by</label>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                          className="w-full border border-stroke bg-surface-2 rounded-xl px-3 py-2 text-sm text-dark outline-none focus:border-primary transition-all duration-200">
                          <option value="relevance">Relevance</option>
                          <option value="date">Date</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-dark-5 mb-1 font-medium">Date posted</label>
                        <select value={datePosted} onChange={(e) => setDatePosted(e.target.value as any)}
                          className="w-full border border-stroke bg-surface-2 rounded-xl px-3 py-2 text-sm text-dark outline-none focus:border-primary transition-all duration-200">
                          <option value="">Any time</option>
                          <option value="past_24h">Past 24 hours</option>
                          <option value="past_week">Past week</option>
                          <option value="past_month">Past month</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-dark-5 mb-1 font-medium">Content type</label>
                        <select value={contentType} onChange={(e) => setContentType(e.target.value as any)}
                          className="w-full border border-stroke bg-surface-2 rounded-xl px-3 py-2 text-sm text-dark outline-none focus:border-primary transition-all duration-200">
                          <option value="">All</option>
                          <option value="images">Images</option>
                          <option value="videos">Videos</option>
                          <option value="documents">Documents</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-dark-5 mb-1 font-medium">Author keywords</label>
                        <input type="text" placeholder="e.g. CEO, founder..." value={authorKeywords} onChange={(e) => setAuthorKeywords(e.target.value)}
                          className="w-full border border-stroke bg-surface-2 rounded-xl px-3 py-2 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>

            {hasSearched && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-dark-5">
                      Showing {allItems.length} result(s)
                      {totalCount != null && totalCount > allItems.length && <span> of {totalCount.toLocaleString()} total</span>}
                    </p>
                    {canInvite && inviteTargets.size > 0 && (
                      <button type="button" onClick={selectedForInvite.size === inviteTargets.size ? deselectAllForInvite : selectAllForInvite}
                        className="text-xs text-primary hover:text-accent font-medium transition-colors">
                        {selectedForInvite.size === inviteTargets.size ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>
                  {allItems.length > 0 && (
                    <motion.button type="button" onClick={openExportModal}
                      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-1.5 bg-primary hover:bg-accent text-white rounded-xl px-5 py-2 text-xs font-medium transition-all duration-200">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Export CSV
                    </motion.button>
                  )}
                </div>

                {allItems.length === 0 && !searching ? (
                  <div className="text-center py-8 text-dark-5 text-sm">No results found. Try different keywords.</div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {allItems.map((item: any, i: number) => (
                        <motion.div key={item.id || `result-${i}`}
                          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}>
                          {searchCategory === 'posts' ? renderPostResult(item) : renderPeopleCompanyResult(item)}
                        </motion.div>
                      ))}
                    </div>
                    {hasMore && (
                      <div className="flex justify-center pt-2">
                        <motion.button type="button" onClick={handleLoadMore} disabled={loadingMore}
                          whileHover={loadingMore ? {} : { scale: 1.03 }} whileTap={loadingMore ? {} : { scale: 0.97 }}
                          className="flex items-center gap-2 bg-surface-2 hover:bg-surface-3 border border-stroke text-dark rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-all duration-200">
                          {loadingMore ? (
                            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Loading...</>
                          ) : (
                            <>Load More{totalCount != null && <span className="text-dark-5 text-xs">({allItems.length}/{totalCount.toLocaleString()})</span>}</>
                          )}
                        </motion.button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'post' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-dark">Share on LinkedIn</h2>
            <p className="text-sm text-dark-5">Create a post that will appear on your LinkedIn feed.</p>
            <form onSubmit={handlePost} className="space-y-4">
              <textarea placeholder="What do you want to share?" value={postText} onChange={(e) => setPostText(e.target.value)}
                rows={6} maxLength={3000}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200" />
              <div className="flex items-center justify-between">
                <span className={`text-xs transition-colors duration-300 ${charRatio > 0.9 ? 'text-red font-medium' : charRatio > 0.7 ? 'text-yellow-dark' : 'text-dark-6'}`}>{postText.length}/3000</span>
                <motion.button type="submit" disabled={posting || !postText.trim() || !selectedAccount}
                  whileHover={posting ? {} : { scale: 1.03 }} whileTap={posting ? {} : { scale: 0.97 }}
                  className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity">
                  {posting ? 'Publishing...' : 'Publish'}
                </motion.button>
              </div>
            </form>
            <AnimatePresence>
              {postSuccess && (<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="bg-green-light-7 border border-green/20 text-green rounded-xl px-4 py-3 text-sm">Post published successfully!</motion.div>)}
            </AnimatePresence>
          </div>
        )}

        {tab === 'message' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-dark">Direct Message</h2>
            <p className="text-sm text-dark-5">Send a private message to a LinkedIn connection.</p>
            <form onSubmit={handleMessage} className="space-y-4">
              <input type="text" placeholder="Chat ID or Provider ID" value={chatId} onChange={(e) => setChatId(e.target.value)}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200" />
              <textarea placeholder="Your message..." value={messageText} onChange={(e) => setMessageText(e.target.value)}
                rows={4} maxLength={5000}
                className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200" />
              <motion.button type="submit" disabled={sending || !chatId || !messageText.trim() || !selectedAccount}
                whileHover={sending ? {} : { scale: 1.03 }} whileTap={sending ? {} : { scale: 0.97 }}
                className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-50 transition-opacity">
                {sending ? 'Sending...' : 'Send Message'}
              </motion.button>
            </form>
            <AnimatePresence>
              {sendSuccess && (<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="bg-green-light-7 border border-green/20 text-green rounded-xl px-4 py-3 text-sm">Message sent successfully!</motion.div>)}
            </AnimatePresence>
          </div>
        )}

        {tab === 'batches' && (
          <div className="bg-surface rounded-2xl border border-stroke/60 p-6">
            <LinkedInBatches accounts={accounts} selectedAccount={selectedAccount} />
          </div>
        )}
      </TabTransition>

      {/* Bulk Invite Floating Bar */}
      <AnimatePresence>
        {selectedForInvite.size > 0 && !showInviteModal && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
              <span className="text-white text-sm font-medium">
                {selectedForInvite.size} {selectedForInvite.size === 1 ? 'person' : 'people'} selected
              </span>
              <div className="w-px h-5 bg-surface/20" />
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => openInviteModal()}
                className="bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
                Send Invitations
              </motion.button>
              <button onClick={deselectAllForInvite} className="text-white/60 hover:text-white text-sm transition-colors ml-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite Modal */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
            onClick={() => !inviting && setShowInviteModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface rounded-2xl p-6 max-w-lg w-full shadow-xl border border-stroke max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>

              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-semibold text-dark">Send LinkedIn Invitations</h3>
                  <p className="text-xs text-dark-5 mt-0.5">
                    {selectedForInvite.size} {selectedForInvite.size === 1 ? 'person' : 'people'} selected
                  </p>
                </div>
                <button onClick={() => !inviting && setShowInviteModal(false)}
                  className="text-dark-5 hover:text-dark transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Recipients */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-dark mb-2">Recipients</label>
                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                  {[...selectedForInvite].map((id) => {
                    const t = inviteTargets.get(id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 bg-primary/10 text-primary rounded-lg px-2.5 py-1 text-xs font-medium">
                        {t?.name || id.slice(0, 12)}
                        <button onClick={() => toggleInviteSelection(id)} className="hover:text-accent transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Message */}
              <div className="mb-5">
                <label className="block text-sm font-medium text-dark mb-2">
                  Invitation Message
                  <span className="text-dark-6 font-normal ml-1">(optional, max 300 chars)</span>
                </label>
                <textarea value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)}
                  maxLength={300} rows={3} placeholder="Hi, I'd like to connect with you..."
                  className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-3 text-sm text-dark outline-none focus:border-primary resize-none placeholder:text-dark-6 transition-all duration-200" />
                <p className={`text-xs mt-1 ${inviteMessage.length > 270 ? 'text-red font-medium' : 'text-dark-6'}`}>
                  {inviteMessage.length}/300
                </p>
              </div>

              {/* Results */}
              {inviteResults && (
                <div className="mb-5 bg-surface-2 rounded-xl border border-stroke/60 p-4 space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green font-medium">{inviteResults.filter((r) => r.status === 'SENT').length} sent</span>
                    {inviteResults.some((r) => r.status === 'FAILED') && (
                      <span className="text-red font-medium">{inviteResults.filter((r) => r.status === 'FAILED').length} failed</span>
                    )}
                  </div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1">
                    {inviteResults.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1">
                        <span className="text-dark truncate">{r.name || r.providerId.slice(0, 20)}</span>
                        <span className={r.status === 'SENT' ? 'text-green font-medium' : 'text-red font-medium'}>
                          {r.status === 'SENT' ? 'Sent' : r.error || 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-stroke/60">
                <button onClick={() => { setShowInviteModal(false); setInviteResults(null); }}
                  className="px-4 py-2 text-sm font-medium text-dark-5 hover:text-dark rounded-xl transition-colors">
                  {inviteResults ? 'Close' : 'Cancel'}
                </button>
                {!inviteResults && (
                  <motion.button whileHover={inviting ? {} : { scale: 1.03 }} whileTap={inviting ? {} : { scale: 0.97 }}
                    onClick={handleBulkInvite} disabled={inviting || selectedForInvite.size === 0}
                    className="flex items-center gap-2 bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50 transition-all duration-200">
                    {inviting ? (
                      <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Sending...</>
                    ) : (
                      <>Send {selectedForInvite.size} {selectedForInvite.size === 1 ? 'Invitation' : 'Invitations'}</>
                    )}
                  </motion.button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Modal */}
      <AnimatePresence>
        {showExportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
            onClick={() => !exporting && setShowExportModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface rounded-2xl p-6 max-w-lg w-full shadow-xl border border-stroke max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-semibold text-dark">Export to CSV</h3>
                  <p className="text-xs text-dark-5 mt-0.5">Choose fields, scope, and limits</p>
                </div>
                <button onClick={() => !exporting && setShowExportModal(false)} className="text-dark-5 hover:text-dark transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mb-5">
                <label className="block text-sm font-medium text-dark mb-2">Export Scope</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setExportScope('page')}
                    className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium border transition-all duration-200 ${exportScope === 'page' ? 'bg-primary text-white border-primary' : 'bg-surface-2 text-dark-5 border-stroke hover:border-dark-5'}`}>
                    Current Page ({allItems.length})
                  </button>
                  <button type="button" onClick={() => setExportScope('all')}
                    className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium border transition-all duration-200 ${exportScope === 'all' ? 'bg-primary text-white border-primary' : 'bg-surface-2 text-dark-5 border-stroke hover:border-dark-5'}`}>
                    All Results {totalCount != null ? `(${totalCount.toLocaleString()})` : ''}
                  </button>
                </div>
              </div>
              <div className="mb-5">
                <label className="block text-sm font-medium text-dark mb-2">Max Results <span className="text-dark-6 font-normal ml-1">(leave empty for no limit)</span></label>
                <input type="number" min="1" placeholder="e.g. 50, 100, 500..." value={exportLimit} onChange={(e) => setExportLimit(e.target.value)}
                  className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary placeholder:text-dark-6 transition-all duration-200" />
              </div>
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-dark">Fields to Export <span className="text-dark-6 font-normal ml-1">({exportSelectedFields.size}/{availableFields.length})</span></label>
                  <div className="flex gap-2">
                    <button type="button" onClick={selectAllFields} disabled={allFieldsSelected} className="text-xs text-primary hover:text-accent font-medium disabled:opacity-40 transition-colors">Select All</button>
                    <span className="text-dark-6 text-xs">|</span>
                    <button type="button" onClick={deselectAllFields} disabled={noFieldsSelected} className="text-xs text-primary hover:text-accent font-medium disabled:opacity-40 transition-colors">Deselect All</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {availableFields.map((field) => (
                    <label key={field.key} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-all duration-150 ${exportSelectedFields.has(field.key) ? 'bg-primary/8 border border-primary/20' : 'bg-surface-2 border border-transparent hover:bg-surface-3'}`}>
                      <input type="checkbox" checked={exportSelectedFields.has(field.key)} onChange={() => toggleField(field.key)} className="accent-primary w-3.5 h-3.5 cursor-pointer" />
                      <span className="text-sm text-dark truncate">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-stroke/60">
                <button onClick={() => !exporting && setShowExportModal(false)} className="px-4 py-2 text-sm font-medium text-dark-5 hover:text-dark rounded-xl transition-colors">Cancel</button>
                <motion.button whileHover={exporting || noFieldsSelected ? {} : { scale: 1.03 }} whileTap={exporting || noFieldsSelected ? {} : { scale: 0.97 }}
                  onClick={handleExport} disabled={exporting || noFieldsSelected}
                  className="flex items-center gap-2 bg-primary hover:bg-accent text-white rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50 transition-all duration-200">
                  {exporting ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Exporting...</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>Export {exportScope === 'all' ? 'All' : 'Page'}</>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedPage>
  );
}
