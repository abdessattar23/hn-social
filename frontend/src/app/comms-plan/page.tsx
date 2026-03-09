'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AnimatedPage } from '@/components/motion';
import { motion } from 'framer-motion';

interface JourneyStep {
    key: string;
    order: number;
    label: string;
    content: string;
    templateType: 'bulk' | 'personal';
    who: string;
}

interface StepStatus {
    step_key: string;
    batch_number: number;
    status: 'pending' | 'done' | 'skipped';
    completed_at: string | null;
    completed_by: string | null;
    notes: string | null;
    auto_detected: boolean;
}

interface CommsPlanRow {
    step: JourneyStep;
    batches: Record<number, StepStatus>;
}

interface AdmissionBatch {
    number: number;
    label: string;
    applicationStart: string;
    commsDeadline: string;
}

interface BatchLabel {
    number: number;
    label: string;
    dates: string;
}

function formatBatchLabel(b: AdmissionBatch): BatchLabel {
    const fmt = (iso: string) =>
        new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
        number: b.number,
        label: `B${b.number}`,
        dates: `${fmt(b.applicationStart)} \u2013 ${fmt(b.commsDeadline)}`,
    };
}

const statusStyles: Record<string, { bg: string; text: string; icon: string; label: string }> = {
    pending: { bg: 'bg-surface-2', text: 'text-dark-5', icon: '○', label: 'Pending' },
    done: { bg: 'bg-green-light-7', text: 'text-green', icon: '✓', label: 'Done' },
    skipped: { bg: 'bg-gray-2', text: 'text-dark-5', icon: '⏭', label: 'Skipped' },
};

const nextStatus: Record<string, 'pending' | 'done' | 'skipped'> = {
    pending: 'done',
    done: 'skipped',
    skipped: 'pending',
};

const templateBadge = (type: string) => {
    if (type === 'bulk') return 'bg-blue-light-5 text-blue';
    return 'bg-purple-100 text-purple-700';
};

export default function CommsPlanPage() {
    const { authed } = useRequireAuth();
    const [plan, setPlan] = useState<CommsPlanRow[]>([]);
    const [batchLabels, setBatchLabels] = useState<BatchLabel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toggling, setToggling] = useState<string | null>(null);

    const load = useCallback(() => {
        Promise.all([
            api.get('/comms-plan') as Promise<CommsPlanRow[]>,
            api.get('/personal-messages/admission-batches') as Promise<AdmissionBatch[]>,
        ])
            .then(([planData, batches]) => {
                setPlan(planData || []);
                setBatchLabels((batches || []).map(formatBatchLabel));
                setLoading(false);
            })
            .catch((err: Error) => { setError(err.message || 'Failed to load'); setLoading(false); });
    }, []);

    useEffect(() => {
        if (!authed) return;
        load();
    }, [authed, load]);

    const toggle = async (stepKey: string, batchNumber: number, currentStatus: string) => {
        const key = `${stepKey}:${batchNumber}`;
        setToggling(key);
        try {
            const newStatus = nextStatus[currentStatus] || 'done';
            await api.patch(`/comms-plan/${stepKey}/${batchNumber}`, { status: newStatus });
            // Optimistic update
            setPlan((prev) =>
                prev.map((row) => {
                    if (row.step.key !== stepKey) return row;
                    return {
                        ...row,
                        batches: {
                            ...row.batches,
                            [batchNumber]: {
                                ...row.batches[batchNumber],
                                status: newStatus,
                                auto_detected: false,
                            },
                        },
                    };
                }),
            );
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to update');
        } finally {
            setToggling(null);
        }
    };

    // Compute progress stats
    const batchCount = batchLabels.length || 6;
    const totalCells = plan.length * batchCount;
    const doneCells = plan.reduce((acc, row) => {
        return acc + Object.values(row.batches).filter((b) => b.status === 'done').length;
    }, 0);
    const skippedCells = plan.reduce((acc, row) => {
        return acc + Object.values(row.batches).filter((b) => b.status === 'skipped').length;
    }, 0);
    const completedPercent = totalCells > 0 ? Math.round(((doneCells + skippedCells) / totalCells) * 100) : 0;

    if (!authed) return null;

    return (
        <AnimatedPage className="pb-20">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Communication Plan</h1>
                <p className="text-sm text-dark-5">Track every step of the hackathon communication journey across all batches.</p>
            </div>

            {error && (
                <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
                </div>
            )}

            {/* Progress Overview */}
            <div className="rounded-2xl bg-surface p-5 shadow-1 border border-stroke/60 mb-6">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-dark font-semibold text-sm">Overall Progress</p>
                            <p className="text-dark-5 text-xs">{doneCells} done · {skippedCells} skipped · {totalCells - doneCells - skippedCells} pending</p>
                        </div>
                    </div>
                    <span className="text-2xl font-bold text-primary">{completedPercent}%</span>
                </div>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${completedPercent}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 text-xs">
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-surface-2 flex items-center justify-center text-dark-5">○</span>
                    Pending
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-green-light-7 flex items-center justify-center text-green font-bold">✓</span>
                    Done
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-gray-2 flex items-center justify-center text-dark-5">⏭</span>
                    Skipped
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-green-light-7 border-2 border-primary/40 flex items-center justify-center text-green font-bold text-[10px]">⚡</span>
                    Auto-detected
                </span>
                <button
                    onClick={load}
                    className="ml-auto text-primary hover:text-accent text-xs font-medium transition-colors flex items-center gap-1"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* Journey Table */}
            {loading ? (
                <div className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60">
                    <div className="animate-spin text-3xl mb-3">⟳</div>
                    <p className="text-dark-5 text-sm">Loading communication plan...</p>
                </div>
            ) : (
                <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-surface-2/50">
                                    <th className="text-left px-4 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider w-8">#</th>
                                    <th className="text-left px-4 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider min-w-[140px]">Step</th>
                                    <th className="text-left px-4 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider min-w-[200px] hidden lg:table-cell">Content</th>
                                    <th className="text-left px-4 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider w-20">Type</th>
                                    <th className="text-left px-4 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider min-w-[120px] hidden xl:table-cell">Who</th>
                                    {batchLabels.map((b) => (
                                        <th key={b.number} className="text-center px-2 py-3 text-dark-5 font-medium text-xs uppercase tracking-wider w-16">
                                            <div>{b.label}</div>
                                            <div className="text-[10px] font-normal normal-case text-dark-6 mt-0.5">{b.dates.split('–')[0].trim()}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {plan.map((row, i) => {
                                    const rowDone = Object.values(row.batches).filter((b) => b.status === 'done' || b.status === 'skipped').length;
                                    const isRowComplete = rowDone === batchCount;
                                    return (
                                        <tr
                                            key={row.step.key}
                                            className={`border-t border-stroke/30 transition-colors hover:bg-surface-2/30 ${isRowComplete ? 'opacity-60' : ''}`}
                                        >
                                            <td className="px-4 py-3 text-dark-5 text-xs font-mono">{row.step.order}</td>
                                            <td className="px-4 py-3">
                                                <span className="font-medium text-dark">{row.step.label}</span>
                                            </td>
                                            <td className="px-4 py-3 text-dark-5 text-xs hidden lg:table-cell">
                                                {row.step.content}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${templateBadge(row.step.templateType)}`}>
                                                    {row.step.templateType === 'bulk' ? 'Bulk' : 'Personal'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-dark-5 text-xs hidden xl:table-cell">{row.step.who}</td>
                                            {batchLabels.map((b) => {
                                                const cell = row.batches[b.number];
                                                const st = statusStyles[cell.status] || statusStyles.pending;
                                                const isToggling = toggling === `${row.step.key}:${b.number}`;
                                                return (
                                                    <td key={b.number} className="px-2 py-3 text-center">
                                                        <motion.button
                                                            whileHover={{ scale: 1.15 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={() => toggle(row.step.key, b.number, cell.status)}
                                                            disabled={isToggling}
                                                            className={`w-8 h-8 rounded-lg ${st.bg} ${st.text} font-bold text-sm flex items-center justify-center mx-auto transition-all ${isToggling ? 'opacity-50' : 'cursor-pointer hover:shadow-md'} ${cell.auto_detected ? 'ring-2 ring-primary/40' : ''}`}
                                                            title={`${st.label}${cell.auto_detected ? ' (auto-detected)' : ''} — Click to change`}
                                                        >
                                                            {cell.auto_detected && cell.status === 'done' ? '⚡' : st.icon}
                                                        </motion.button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Per-Step Summary Cards */}
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {plan.map((row) => {
                    const doneBatches = Object.values(row.batches).filter((b) => b.status === 'done').length;
                    const skippedBatches = Object.values(row.batches).filter((b) => b.status === 'skipped').length;
                    const stepProgress = Math.round(((doneBatches + skippedBatches) / batchCount) * 100);
                    return (
                        <motion.div
                            key={row.step.key}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: row.step.order * 0.03 }}
                            className="rounded-xl bg-surface p-3 shadow-1 border border-stroke/40"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-dark truncate">{row.step.label}</span>
                                <span className={`text-xs font-bold ${stepProgress === 100 ? 'text-green' : 'text-dark-5'}`}>{stepProgress}%</span>
                            </div>
                            <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                                <motion.div
                                    className={`h-full rounded-full ${stepProgress === 100 ? 'bg-green' : 'bg-primary'}`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${stepProgress}%` }}
                                    transition={{ duration: 0.4, ease: 'easeOut' }}
                                />
                            </div>
                            <div className="flex gap-1 mt-2">
                                {batchLabels.map((b) => {
                                    const cell = row.batches[b.number];
                                    const color = cell.status === 'done' ? 'bg-green' : cell.status === 'skipped' ? 'bg-dark-5' : 'bg-surface-2';
                                    return <div key={b.number} className={`flex-1 h-1 rounded-full ${color}`} />;
                                })}
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </AnimatedPage>
    );
}
