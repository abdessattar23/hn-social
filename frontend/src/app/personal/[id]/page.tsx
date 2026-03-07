'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AnimatedPage, AnimatedCard, StaggerContainer, StaggerItem } from '@/components/motion';
import { motion } from 'framer-motion';

type Item = {
    id: number;
    recipient_name: string;
    recipient_identifier: string;
    message_body: string;
    subject: string | null;
    status: string;
    error: string | null;
    sent_at: string | null;
};

type Batch = {
    id: number;
    name: string;
    channel: string;
    account_id: string;
    status: string;
    total: number;
    sent: number;
    failed: number;
    created_at: string;
    items: Item[];
};

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    PENDING: { bg: 'bg-surface-2', text: 'text-dark-5', dot: 'bg-dark-6' },
    SENT: { bg: 'bg-green-light-7', text: 'text-green', dot: 'bg-green' },
    FAILED: { bg: 'bg-red-light-6', text: 'text-red', dot: 'bg-red' },
};

const batchStatusConfig: Record<string, { bg: string; text: string; dot: string; pulse?: boolean }> = {
    DRAFT: { bg: 'bg-gray-2', text: 'text-dark-5', dot: 'bg-dark-5' },
    SENDING: { bg: 'bg-yellow-light-4', text: 'text-yellow-dark', dot: 'bg-yellow-dark', pulse: true },
    SENT: { bg: 'bg-green-light-7', text: 'text-green', dot: 'bg-green' },
    FAILED: { bg: 'bg-red-light-6', text: 'text-red', dot: 'bg-red' },
};

const channelBadge = (ch: string) => {
    if (ch === 'EMAIL') return 'bg-blue-light-5 text-blue';
    if (ch === 'WHATSAPP') return 'bg-green-light-7 text-green';
    return 'bg-linkedin-light text-linkedin';
};

export default function PersonalDetailPage() {
    const { authed } = useRequireAuth();
    const params = useParams();
    const id = Number(params.id);
    const [batch, setBatch] = useState<Batch | null>(null);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [sending, setSending] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    // Subject for EMAIL batches
    const [batchSubject, setBatchSubject] = useState('');

    const [dailySendLimit, setDailySendLimit] = useState<number>(100);
    const [delayMin, setDelayMin] = useState<number>(5);
    const [delayMax, setDelayMax] = useState<number>(15);
    const [isEditingLimit, setIsEditingLimit] = useState(false);
    const [isEditingDelay, setIsEditingDelay] = useState(false);

    // Selection state
    const [excludedItemIds, setExcludedItemIds] = useState<Set<number>>(new Set());

    // Emergency mode
    const [emergencyMode, setEmergencyMode] = useState(false);

    // Live logs
    type LogEntry = { timestamp: string; level: string; message: string };
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);
    const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(() => {
        api
            .get(`/personal-messages/${id}`)
            .then((d: Batch) => {
                setBatch(d);
                // Pre-populate subject from first item
                const firstSubject = d.items?.find(i => i.subject)?.subject;
                if (firstSubject && !batchSubject) setBatchSubject(firstSubject);
                // Auto-poll while sending
                if (d.status === 'SENDING' && !pollRef.current) {
                    pollRef.current = setInterval(() => {
                        api.get(`/personal-messages/${id}`).then((updated: Batch) => {
                            setBatch(updated);
                            if (updated.status !== 'SENDING') {
                                if (pollRef.current) clearInterval(pollRef.current);
                                pollRef.current = null;
                            }
                        });
                    }, 3000);
                }
            })
            .catch((err: any) => setError(err.message || 'Failed to load'));
    }, [id]);

    useEffect(() => {
        if (!authed) return;
        load();

        // Load initial daily limit
        api.get('/org/send-limit')
            .then((d: any) => setDailySendLimit(d.dailySendLimit))
            .catch(() => { });

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [authed, load]);

    const handleUpload = async (file: File) => {
        if (!file.name.endsWith('.csv')) {
            setError('Please upload a .csv file');
            return;
        }
        setUploading(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            await api.upload(`/personal-messages/${id}/import-csv`, formData);
            load();
        } catch (err: any) {
            setError(err.message || 'Failed to import CSV');
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleUpload(file);
    };

    const handleSaveLimit = async () => {
        try {
            await api.patch('/org/send-limit', { limit: dailySendLimit });
            setIsEditingLimit(false);
        } catch (err: any) {
            setError(err.message || 'Failed to update limit');
        }
    };

    // Poll logs while sending
    useEffect(() => {
        if (batch?.status === 'SENDING') {
            // Start polling logs
            const pollLogs = () => {
                api.get(`/personal-messages/${id}/logs`)
                    .then((d: any) => {
                        setLogs(d.logs || []);
                        setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                    })
                    .catch(() => { });
            };
            pollLogs();
            logPollRef.current = setInterval(pollLogs, 1500);
        } else if (batch?.status === 'SENT' || batch?.status === 'FAILED') {
            // Final fetch
            api.get(`/personal-messages/${id}/logs`)
                .then((d: any) => setLogs(d.logs || []))
                .catch(() => { });
            if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; }
        }
        return () => {
            if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; }
        };
    }, [batch?.status, id]);

    const handleSend = async () => {
        // For EMAIL batches, ensure subject is set
        if (batch?.channel === 'EMAIL') {
            const hasSubject = batch.items.some(i => i.subject);
            if (!hasSubject && !batchSubject.trim()) {
                setError('Please enter an email subject before sending.');
                return;
            }
            // Auto-apply subject if the user typed one
            if (batchSubject.trim()) {
                try {
                    await api.patch(`/personal-messages/${id}/subject`, { subject: batchSubject.trim() });
                } catch (err: any) {
                    setError(err.message || 'Failed to set subject');
                    return;
                }
            }
        }

        if (!confirm('Send to selected messages in this batch? Deselected messages will be removed permanently.')) return;

        if (delayMin >= delayMax) {
            setError('Minimum delay must be less than maximum delay');
            return;
        }

        setSending(true);
        setError('');
        try {
            await api.post(`/personal-messages/${id}/send`, {
                delayMinMs: emergencyMode ? 0 : delayMin * 1000,
                delayMaxMs: emergencyMode ? 0 : delayMax * 1000,
                excludeItemIds: Array.from(excludedItemIds),
                emergencyMode
            });
            // Clear selections after sending
            setExcludedItemIds(new Set());
            load();
        } catch (err: any) {
            setError(err.message || 'Failed to send');
        } finally {
            setSending(false);
        }
    };

    const handleToggleItem = (itemId: number) => {
        setExcludedItemIds(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    };

    const handleToggleAll = (currentItems: Item[]) => {
        const sendableItems = currentItems.filter(i => i.status === 'PENDING' || i.status === 'FAILED');
        if (sendableItems.length === 0) return;

        const allExcluded = sendableItems.every(i => excludedItemIds.has(i.id));
        setExcludedItemIds(prev => {
            const next = new Set(prev);
            if (allExcluded) {
                // If all are excluded, select them all (clear exclusions for these items)
                sendableItems.forEach(i => next.delete(i.id));
            } else {
                // Exclude all sendable items
                sendableItems.forEach(i => next.add(i.id));
            }
            return next;
        });
    };

    if (!authed) return null;
    if (!batch) {
        return (
            <AnimatedPage>
                {error ? (
                    <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm">
                        {error}
                    </div>
                ) : (
                    <div className="text-center py-20 text-dark-5">Loading...</div>
                )}
            </AnimatedPage>
        );
    }

    const bsc = batchStatusConfig[batch.status] || batchStatusConfig.DRAFT;
    const progress = batch.total > 0 ? Math.round(((batch.sent + batch.failed) / batch.total) * 100) : 0;
    const canUpload = batch.status === 'DRAFT';
    const canSend = (batch.status === 'DRAFT' || batch.status === 'FAILED') && batch.items.length > 0;

    return (
        <AnimatedPage className="pb-20">
            {/* Header */}
            <div className="mb-6">
                <Link href="/personal" className="text-sm text-dark-5 hover:text-primary transition-colors mb-2 inline-block">
                    &larr; Back to Personal Messages
                </Link>
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-dark tracking-tight">{batch.name}</h1>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-medium ${channelBadge(batch.channel)}`}>
                        {batch.channel}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${bsc.bg} ${bsc.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${bsc.dot} ${bsc.pulse ? 'animate-pulse' : ''}`} />
                        {batch.status}
                    </span>
                </div>
                <p className="text-sm text-dark-5 mt-1">
                    {batch.total} recipients &middot; {batch.sent} sent &middot; {batch.failed} failed
                </p>
            </div>

            {error && (
                <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
                </div>
            )}

            {/* Progress bar */}
            {batch.total > 0 && (
                <div className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 mb-6">
                    <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-dark font-medium">Progress</span>
                        <span className="text-dark-5">
                            {batch.sent + batch.failed} / {batch.total} ({progress}%)
                        </span>
                    </div>
                    <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                        />
                    </div>
                </div>
            )}

            {/* Subject Input for EMAIL */}
            {batch.channel === 'EMAIL' && (
                <div className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 mb-6">
                    <label className="text-sm font-medium text-dark mb-2 block">Email Subject</label>
                    <div className="flex gap-3">
                        <input
                            type="text"
                            placeholder="Enter email subject line..."
                            value={batchSubject}
                            onChange={(e) => setBatchSubject(e.target.value)}
                            className="flex-1 border border-stroke rounded-xl px-4 py-2.5 text-sm outline-none bg-surface-2 transition-all duration-200 focus:border-primary"
                        />
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={async () => {
                                if (!batchSubject.trim()) { setError('Subject cannot be empty'); return; }
                                try {
                                    await api.patch(`/personal-messages/${id}/subject`, { subject: batchSubject.trim() });
                                    load();
                                } catch (err: any) {
                                    setError(err.message || 'Failed to update subject');
                                }
                            }}
                            className="bg-primary hover:bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
                        >
                            Apply to All
                        </motion.button>
                    </div>
                    <p className="text-dark-5 text-xs mt-2">Sets this subject on all items in the batch.</p>
                </div>
            )}

            {/* Live Terminal Logs */}
            {logs.length > 0 && (
                <div className="rounded-2xl overflow-hidden shadow-1 border border-stroke/60 mb-6">
                    <div className="bg-[#1a1a2e] px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1.5">
                                <span className="w-3 h-3 rounded-full bg-red/80" />
                                <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
                                <span className="w-3 h-3 rounded-full bg-green/80" />
                            </div>
                            <span className="text-gray-400 text-xs font-mono ml-2">dispatch.log</span>
                        </div>
                        {batch.status === 'SENDING' && (
                            <span className="text-green text-xs font-mono animate-pulse">● LIVE</span>
                        )}
                    </div>
                    <div className="bg-[#16213e] max-h-[280px] overflow-y-auto px-5 py-3 font-mono text-xs leading-relaxed">
                        {logs.map((log, i) => {
                            const time = new Date(log.timestamp).toLocaleTimeString();
                            const colors: Record<string, string> = {
                                info: 'text-blue-300',
                                warn: 'text-yellow-300',
                                error: 'text-red-400',
                                success: 'text-green-400',
                            };
                            return (
                                <div key={i} className="flex gap-3">
                                    <span className="text-gray-500 shrink-0">{time}</span>
                                    <span className={colors[log.level] || 'text-gray-300'}>{log.message}</span>
                                </div>
                            );
                        })}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}

            {/* CSV Upload Zone */}
            {canUpload && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer mb-6 transition-all duration-200 ${dragOver
                        ? 'border-primary bg-primary/5'
                        : 'border-stroke hover:border-primary/50 bg-surface'
                        }`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUpload(file);
                            e.target.value = '';
                        }}
                        className="hidden"
                    />
                    <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                        </svg>
                    </div>
                    <p className="text-dark font-semibold mb-1">
                        {uploading ? 'Uploading...' : 'Drop your CSV here or click to browse'}
                    </p>
                    <p className="text-dark-5 text-sm">
                        CSV should have columns: <code className="text-primary">name</code>, <code className="text-primary">identifier</code> (email/phone/chat ID), <code className="text-primary">message</code>{batch.channel === 'EMAIL' && <>, and optionally <code className="text-primary">subject</code></>}
                    </p>
                </div>
            )}

            {/* Actions & Settings */}
            <div className="flex flex-col gap-4 mb-6">
                {(canSend || batch.status === 'SENDING') && (
                    <div className="flex flex-wrap items-center gap-4 bg-surface-2/40 border border-stroke rounded-2xl p-4">
                        <div className="flex items-center gap-4 flex-wrap flex-1">
                            {/* Daily Limit Badge */}
                            <div className="flex items-center gap-2 bg-surface border border-stroke rounded-xl px-3 py-2 shadow-sm">
                                <span className="text-sm font-medium text-dark-5">Daily Limit:</span>
                                {isEditingLimit ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            className="w-20 px-2 py-1 text-sm border border-stroke rounded-md bg-transparent focus:outline-none focus:border-primary"
                                            value={dailySendLimit}
                                            onChange={(e) => setDailySendLimit(Number(e.target.value))}
                                            min={1}
                                        />
                                        <button onClick={handleSaveLimit} className="text-primary hover:text-accent text-sm font-medium">Save</button>
                                        <button onClick={() => setIsEditingLimit(false)} className="text-dark-5 hover:text-dark text-sm">Cancel</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingLimit(true)}>
                                        <span className="text-sm font-semibold text-dark">{dailySendLimit} msgs/day</span>
                                        <svg className="w-3.5 h-3.5 text-dark-5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Dynamic Delay Badge */}
                            <div className="flex items-center gap-2 bg-surface border border-stroke rounded-xl px-3 py-2 shadow-sm">
                                <span className="text-sm font-medium text-dark-5">Delay Between Messages:</span>
                                {isEditingDelay ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            className="w-16 px-2 py-1 text-sm border border-stroke rounded-md bg-transparent focus:outline-none focus:border-primary"
                                            value={delayMin}
                                            onChange={(e) => setDelayMin(Number(e.target.value))}
                                            min={1}
                                        />
                                        <span className="text-dark-5">-</span>
                                        <input
                                            type="number"
                                            className="w-16 px-2 py-1 text-sm border border-stroke rounded-md bg-transparent focus:outline-none focus:border-primary"
                                            value={delayMax}
                                            onChange={(e) => setDelayMax(Number(e.target.value))}
                                            min={1}
                                        />
                                        <span className="text-dark-5 text-sm">sec</span>
                                        <button onClick={() => setIsEditingDelay(false)} className="text-primary hover:text-accent text-sm font-medium ml-1">Done</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingDelay(true)}>
                                        <span className="text-sm font-semibold text-dark">{delayMin}-{delayMax} seconds</span>
                                        <svg className="w-3.5 h-3.5 text-dark-5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Emergency / Stop Button */}
                            {batch.status === 'SENDING' ? (
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={async () => {
                                        try {
                                            await api.post(`/personal-messages/${id}/stop`);
                                        } catch (err: any) {
                                            setError(err.message || 'Failed to stop');
                                        }
                                    }}
                                    className="flex items-center gap-2 rounded-xl px-4 py-2 shadow-sm border border-red/40 bg-red text-white hover:bg-red/80 transition-all duration-200 animate-pulse"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                                    </svg>
                                    <span className="text-sm font-bold whitespace-nowrap">Stop Sending</span>
                                </motion.button>
                            ) : (
                                <button
                                    onClick={() => setEmergencyMode(!emergencyMode)}
                                    className={`flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all duration-200 ${emergencyMode
                                        ? 'bg-red/10 border-red/30 text-red'
                                        : 'bg-surface border-stroke text-dark-5 hover:border-dark-6'
                                        }`}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                                    </svg>
                                    <span className="text-sm font-semibold whitespace-nowrap">
                                        {emergencyMode ? '⚡ Emergency ON' : 'Emergency'}
                                    </span>
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                            {canSend && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={handleSend}
                                    disabled={sending}
                                    className={`text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${emergencyMode ? 'bg-red hover:bg-red/80' : 'bg-primary hover:bg-accent'}`}
                                >
                                    {sending ? 'Starting...' : `${emergencyMode ? '⚡ ' : ''}Send Selected (${batch.items.filter(i => !excludedItemIds.has(i.id) && (i.status === 'PENDING' || i.status === 'FAILED')).length})`}
                                </motion.button>
                            )}
                            {batch.status === 'SENDING' && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={load}
                                    className="border border-stroke bg-surface hover:bg-surface-2 text-dark font-semibold rounded-xl px-5 py-3 text-sm transition-colors"
                                >
                                    Refresh Progress
                                </motion.button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Items table */}
            {batch.items.length > 0 && (
                <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-stroke bg-surface-2">
                                    <th className="w-12 px-5 py-3">
                                        <input
                                            type="checkbox"
                                            className="rounded border-stroke text-primary focus:ring-primary h-4 w-4 bg-transparent cursor-pointer"
                                            checked={
                                                batch.items.filter(i => i.status === 'PENDING' || i.status === 'FAILED').length > 0 &&
                                                batch.items.filter(i => i.status === 'PENDING' || i.status === 'FAILED').every(i => !excludedItemIds.has(i.id))
                                            }
                                            onChange={() => handleToggleAll(batch.items)}
                                            disabled={batch.status === 'SENDING' || batch.status === 'SENT'}
                                        />
                                    </th>
                                    <th className="text-left px-5 py-3 font-medium text-dark-5 uppercase text-xs tracking-wider">Name</th>
                                    <th className="text-left px-5 py-3 font-medium text-dark-5 uppercase text-xs tracking-wider">Identifier</th>
                                    {batch.channel === 'EMAIL' && (
                                        <th className="text-left px-5 py-3 font-medium text-dark-5 uppercase text-xs tracking-wider">Subject</th>
                                    )}
                                    <th className="text-left px-5 py-3 font-medium text-dark-5 uppercase text-xs tracking-wider">Message</th>
                                    <th className="text-left px-5 py-3 font-medium text-dark-5 uppercase text-xs tracking-wider">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {batch.items.map((item) => {
                                    const isc = statusConfig[item.status] || statusConfig.PENDING;
                                    const isSendable = item.status === 'PENDING' || item.status === 'FAILED';

                                    return (
                                        <tr key={item.id} className={`border-b border-stroke/40 last:border-none transition-colors ${excludedItemIds.has(item.id) ? 'bg-surface-2/30 opacity-75' : 'hover:bg-surface-2/50'}`}>
                                            <td className="px-5 py-3">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-stroke text-primary focus:ring-primary h-4 w-4 disabled:opacity-50 disabled:cursor-not-allowed bg-transparent cursor-pointer"
                                                    checked={!excludedItemIds.has(item.id)}
                                                    onChange={() => handleToggleItem(item.id)}
                                                    disabled={!isSendable || batch.status === 'SENDING' || batch.status === 'SENT'}
                                                />
                                            </td>
                                            <td className="px-5 py-3 font-medium text-dark">{item.recipient_name}</td>
                                            <td className="px-5 py-3 text-dark-5 font-mono text-xs">{item.recipient_identifier}</td>
                                            {batch.channel === 'EMAIL' && (
                                                <td className="px-5 py-3 text-dark-5 max-w-[200px] truncate">{item.subject || '—'}</td>
                                            )}
                                            <td className="px-5 py-3 text-dark-5 max-w-[300px]">
                                                <span className="line-clamp-2">{item.message_body}</span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${isc.bg} ${isc.text}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${isc.dot}`} />
                                                    {item.status}
                                                </span>
                                                {item.error && (
                                                    <p className="text-xs text-red mt-1 max-w-[200px] truncate" title={item.error}>
                                                        {item.error}
                                                    </p>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </AnimatedPage>
    );
}
