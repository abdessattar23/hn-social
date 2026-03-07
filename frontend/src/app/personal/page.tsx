'use client';
import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatedPage, AnimatedCard, StaggerContainer, StaggerItem, SlideDown, SpringIn } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Batch = {
    id: number;
    name: string;
    channel: string;
    status: string;
    total: number;
    sent: number;
    failed: number;
    created_at: string;
    account_id: string;
};

type Account = { id: string; type: string; name?: string };

const WHATSAPP_TYPES = ['WHATSAPP'];
const LINKEDIN_TYPES = ['LINKEDIN', 'LINKEDIN_OAUTH'];
const EMAIL_TYPES = ['MAIL', 'GOOGLE', 'GOOGLE_OAUTH', 'IMAP', 'OUTLOOK'];

const channelBadge = (ch: string) => {
    if (ch === 'EMAIL') return 'bg-blue-light-5 text-blue';
    if (ch === 'WHATSAPP') return 'bg-green-light-7 text-green';
    return 'bg-linkedin-light text-linkedin';
};

const statusConfig: Record<string, { bg: string; text: string; dot: string; pulse?: boolean }> = {
    DRAFT: { bg: 'bg-gray-2', text: 'text-dark-5', dot: 'bg-dark-5' },
    SENDING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark', dot: 'bg-yellow-dark', pulse: true },
    SENT: { bg: 'bg-green-light-7', text: 'text-green', dot: 'bg-green' },
    FAILED: { bg: 'bg-red-light-6', text: 'text-red', dot: 'bg-red' },
};

function accountsForChannel(accounts: Account[], channel: string) {
    return accounts.filter((a) => {
        if (channel === 'EMAIL') return EMAIL_TYPES.includes(a.type);
        if (channel === 'WHATSAPP') return WHATSAPP_TYPES.includes(a.type);
        if (channel === 'LINKEDIN') return LINKEDIN_TYPES.includes(a.type);
        return false;
    });
}

export default function PersonalPage() {
    const { authed } = useRequireAuth();
    const [batches, setBatches] = useState<Batch[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP' | 'LINKEDIN'>('EMAIL');
    const [accountId, setAccountId] = useState('');
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [deleting, setDeleting] = useState(false);

    // Sync applications state
    const [showSync, setShowSync] = useState(false);
    const [syncStatus, setSyncStatus] = useState('pre_accepted:pre_status');
    const [syncAccountId, setSyncAccountId] = useState('');
    const [syncEventId, setSyncEventId] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [hackathonEvents, setHackathonEvents] = useState<{ id: number; label: string }[]>([]);
    const router = useRouter();

    useEffect(() => {
        if (!authed) return;
        load();
        loadAccounts();
        api.get('/personal-messages/hackathon-events')
            .then((d: any) => setHackathonEvents(d || []))
            .catch(() => { });
    }, [authed]);

    const load = () =>
        api
            .get('/personal-messages')
            .then(setBatches)
            .catch((err: any) => setLoadError(err.message || 'Failed to load'));

    const loadAccounts = () =>
        api
            .get('/unipile/accounts')
            .then((d: any) => setAccounts(d.items || d || []))
            .catch(() => { });

    const availableAccounts = useMemo(() => accountsForChannel(accounts, channel), [accounts, channel]);

    useEffect(() => {
        if (availableAccounts.length > 0 && !availableAccounts.find((a) => a.id === accountId)) {
            setAccountId(availableAccounts[0].id);
        }
    }, [availableAccounts]);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!accountId) {
            setError('No connected account found for this channel. Connect one in Settings.');
            return;
        }
        try {
            await api.post('/personal-messages', { name, channel, accountId });
            setName('');
            setShowForm(false);
            load();
        } catch (err: any) {
            setError(err.message || 'Failed to create batch');
        }
    };

    const remove = async (id: number) => {
        if (!confirm('Delete this batch?')) return;
        await api.del(`/personal-messages/${id}`);
        load();
    };

    const toggleSelect = (id: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const bulkDelete = async () => {
        if (selected.size === 0) return;
        setDeleting(true);
        await Promise.allSettled([...selected].map((id) => api.del(`/personal-messages/${id}`)));
        setSelected(new Set());
        load();
        setDeleting(false);
    };

    const syncApplications = async () => {
        if (!syncAccountId) {
            setError('Please select an email account for sending.');
            return;
        }
        setSyncing(true);
        setError('');
        try {
            const [statusValue, statusField] = syncStatus.split(':');
            const batch: any = await api.post('/personal-messages/sync-applications', {
                statusValue,
                statusField,
                accountId: syncAccountId,
                eventId: syncEventId || undefined,
            });
            setShowSync(false);
            load();
            router.push(`/personal/${batch.id}`);
        } catch (err: any) {
            setError(err.message || 'Failed to sync applications');
        } finally {
            setSyncing(false);
        }
    };

    if (!authed) return null;

    return (
        <AnimatedPage className="pb-20">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Personal Messages</h1>
                <p className="text-sm text-dark-5">Send personalized messages via CSV upload — each recipient gets their own unique message.</p>
            </div>

            {loadError && (
                <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between">
                    <span>{loadError}</span>
                    <button onClick={() => setLoadError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
                </div>
            )}
            {error && <p className="text-red text-sm mb-4">{error}</p>}

            <SlideDown open={showForm}>
                <div className="rounded-2xl bg-surface p-6 shadow-1 mb-6 border border-stroke/60">
                    <form onSubmit={create} className="space-y-4">
                        <input
                            placeholder="Batch name (e.g. 'March Outreach')"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2"
                        />
                        <div className="grid grid-cols-2 gap-4">
                            <select
                                value={channel}
                                onChange={(e) => setChannel(e.target.value as any)}
                                className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface transition-all duration-200 focus:border-primary"
                            >
                                <option value="EMAIL">Email</option>
                                <option value="WHATSAPP">WhatsApp</option>
                                <option value="LINKEDIN">LinkedIn</option>
                            </select>
                            <select
                                value={accountId}
                                onChange={(e) => setAccountId(e.target.value)}
                                className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface transition-all duration-200 focus:border-primary"
                            >
                                {availableAccounts.length === 0 && (
                                    <option value="">No accounts connected</option>
                                )}
                                {availableAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name || a.type} ({a.id.slice(0, 8)}...)
                                    </option>
                                ))}
                            </select>
                        </div>
                        <motion.button
                            type="submit"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors"
                        >
                            Create Batch
                        </motion.button>
                    </form>
                </div>
            </SlideDown>

            <div className="flex items-center gap-3 justify-between mb-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setShowForm(!showForm)}
                        className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap"
                    >
                        {showForm ? 'Cancel' : 'New Batch'}
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setShowSync(!showSync)}
                        className="border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary rounded-xl px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        {showSync ? 'Cancel' : 'Sync Applications'}
                    </motion.button>
                </div>
            </div>

            {/* Sync Applications Panel */}
            <SlideDown open={showSync}>
                <div className="rounded-2xl bg-surface p-6 shadow-1 mb-6 border border-primary/20">
                    <h3 className="text-dark font-semibold text-sm mb-4 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </div>
                        Sync from Hackathon Applications
                    </h3>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <select
                            value={syncEventId}
                            onChange={(e) => setSyncEventId(e.target.value)}
                            className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface-2 transition-all focus:border-primary"
                        >
                            <option value="">All Events</option>
                            {hackathonEvents.map((ev) => (
                                <option key={ev.id} value={ev.id}>{ev.label}</option>
                            ))}
                        </select>
                        <select
                            value={syncStatus}
                            onChange={(e) => setSyncStatus(e.target.value)}
                            className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface-2 transition-all focus:border-primary"
                        >
                            <optgroup label="Pre-Status">
                                <option value="pre_accepted:pre_status">✅ Pre-Accepted</option>
                                <option value="pre_rejected:pre_status">❌ Pre-Rejected</option>
                            </optgroup>
                            <optgroup label="Final Status">
                                <option value="accepted:status">✅ Accepted</option>
                                <option value="rejected:status">❌ Rejected</option>
                                <option value="pending:status">⏳ Pending</option>
                            </optgroup>
                        </select>
                        <select
                            value={syncAccountId}
                            onChange={(e) => setSyncAccountId(e.target.value)}
                            className="border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface-2 transition-all focus:border-primary"
                        >
                            <option value="">Select email account</option>
                            {accountsForChannel(accounts, 'EMAIL').map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name || a.type} ({a.id.slice(0, 8)}...)
                                </option>
                            ))}
                        </select>
                    </div>
                    <p className="text-dark-5 text-xs mb-4">
                        Queries all applications with the selected status and creates a batch with personalized email templates.
                    </p>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={syncApplications}
                        disabled={syncing}
                        className="bg-primary hover:bg-accent disabled:opacity-50 text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {syncing ? (
                            <><span className="animate-spin">⟳</span> Syncing...</>
                        ) : (
                            <>Generate Email Batch</>
                        )}
                    </motion.button>
                </div>
            </SlideDown>

            {batches.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60"
                >
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.451 48.451 0 0 0 5.887-.556c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                        </svg>
                    </div>
                    <p className="text-dark font-semibold text-lg mb-1">No personal message batches yet</p>
                    <p className="text-dark-5 text-sm">Create a batch and upload a CSV with personalized messages for each recipient.</p>
                </motion.div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {batches.map((b, i) => {
                        const sc = statusConfig[b.status] || statusConfig.DRAFT;
                        const progress = b.total > 0 ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
                        return (
                            <motion.div
                                key={b.id}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: i * 0.05 }}
                            >
                                <AnimatedCard className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 hover:border-stroke/50">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                href={`/personal/${b.id}`}
                                                className="font-semibold text-dark hover:text-primary transition-colors truncate block"
                                            >
                                                {b.name}
                                            </Link>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-medium ${channelBadge(b.channel)}`}>
                                                    {b.channel}
                                                </span>
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${sc.bg} ${sc.text}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${sc.pulse ? 'animate-pulse' : ''}`} />
                                                    {b.status}
                                                </span>
                                            </div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={selected.has(b.id)}
                                            onChange={() => toggleSelect(b.id)}
                                            className="accent-primary w-4 h-4 cursor-pointer mt-1"
                                        />
                                    </div>

                                    {b.total > 0 && (
                                        <div className="mb-3">
                                            <div className="flex items-center justify-between text-xs text-dark-5 mb-1">
                                                <span>{b.sent + b.failed} / {b.total}</span>
                                                <span>{progress}%</span>
                                            </div>
                                            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                                                <motion.div
                                                    className="h-full bg-primary rounded-full"
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${progress}%` }}
                                                    transition={{ duration: 0.4, ease: 'easeOut' }}
                                                />
                                            </div>
                                            {b.failed > 0 && (
                                                <p className="text-xs text-red mt-1">{b.failed} failed</p>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between text-xs text-dark-5">
                                        <span>{new Date(b.created_at).toLocaleDateString()}</span>
                                        <button
                                            onClick={() => remove(b.id)}
                                            className="text-red hover:text-red/80 font-medium transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </AnimatedCard>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            <AnimatePresence>
                {selected.size > 0 && (
                    <SpringIn className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                        <div className="flex items-center gap-3 bg-dark-2 rounded-2xl px-6 py-3.5 shadow-lg">
                            <span className="text-white text-sm font-medium">
                                {selected.size} {selected.size === 1 ? 'batch' : 'batches'} selected
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
