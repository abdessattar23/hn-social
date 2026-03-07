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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(() => {
        api
            .get(`/personal-messages/${id}`)
            .then((d: Batch) => {
                setBatch(d);
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

    const handleSend = async () => {
        if (!confirm('Send all messages in this batch? This cannot be undone.')) return;
        setSending(true);
        setError('');
        try {
            await api.post(`/personal-messages/${id}/send`);
            load();
        } catch (err: any) {
            setError(err.message || 'Failed to send');
        } finally {
            setSending(false);
        }
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

            {/* Actions */}
            <div className="flex items-center gap-3 mb-6">
                {canSend && (
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleSend}
                        disabled={sending}
                        className="bg-primary hover:bg-accent text-white rounded-xl px-6 py-3 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {sending ? 'Starting...' : `Send All (${batch.items.length})`}
                    </motion.button>
                )}
                {batch.status === 'SENDING' && (
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={load}
                        className="border border-stroke text-dark-5 hover:text-dark rounded-xl px-5 py-3 text-sm font-medium transition-colors"
                    >
                        Refresh
                    </motion.button>
                )}
            </div>

            {/* Items table */}
            {batch.items.length > 0 && (
                <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-stroke bg-surface-2">
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
                                    return (
                                        <tr key={item.id} className="border-b border-stroke/40 last:border-none hover:bg-surface-2/50 transition-colors">
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
