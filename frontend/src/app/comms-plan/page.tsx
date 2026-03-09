'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { AnimatedPage } from '@/components/motion';
import { RichTextEditor } from '@/components/rich-text-editor';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Loader2 } from 'lucide-react';

interface JourneyStep {
    code: string;
    key: string;
    order: number;
    label: string;
    content: string;
    templateType: 'bulk' | 'personal';
    who: string;
    globalLuma: 'Yes' | '-';
}

interface CommsJourneyTemplate {
    id: number;
    name: string;
    subject: string | null;
    body: string;
}

interface StepStatus {
    step_key: string;
    batch_number: number;
    status: 'pending' | 'done' | 'skipped';
    planned_date: string | null;
    completed_at: string | null;
    completed_by: string | null;
    notes: string | null;
    auto_detected: boolean;
}

interface CommsPlanRow {
    step: JourneyStep;
    template: CommsJourneyTemplate | null;
    batches: Record<number, StepStatus>;
}

interface BatchScheduleDetails {
    number: number;
    label: string;
    applicationDeadline: string;
    commsDecisionDate: string;
    journeyStartDate: string | null;
    journeyEndDate: string | null;
}

interface PlanMilestone {
    key: 'hackathon_date' | 'hub_prio_cutoff';
    label: string;
    date: string;
}

interface CommsPlanMetadataResponse {
    batches: BatchScheduleDetails[];
    milestones: PlanMilestone[];
}

interface TemplateDraft {
    name: string;
    subject: string;
    body: string;
}

const BATCH_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

function formatLongDate(iso: string) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function previewTemplateBody(body: string) {
    return body
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140);
}

function buildPersonalizationLabel(type: JourneyStep['templateType']) {
    return type === 'bulk' ? 'Bulk' : 'Personal';
}

function getMilestoneDate(milestones: PlanMilestone[], key: PlanMilestone['key']) {
    return milestones.find((milestone) => milestone.key === key)?.date || null;
}

const statusStyles: Record<StepStatus['status'], { label: string; tone: string; accent: string; icon: string }> = {
    pending: {
        label: 'Pending',
        tone: 'bg-white border-stroke/70 text-dark',
        accent: 'text-dark-6',
        icon: '',
    },
    done: {
        label: 'Done',
        tone: 'bg-green-light-7 border-green/20 text-green',
        accent: 'text-green',
        icon: '✓',
    },
    skipped: {
        label: 'Skipped',
        tone: 'bg-gray-2 border-gray-3 text-dark-5',
        accent: 'text-dark-5',
        icon: '⏭',
    },
};

export default function CommsPlanPage() {
    const { authed } = useRequireAuth();
    const [plan, setPlan] = useState<CommsPlanRow[]>([]);
    const [batchSchedules, setBatchSchedules] = useState<BatchScheduleDetails[]>([]);
    const [milestones, setMilestones] = useState<PlanMilestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toggling, setToggling] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [editingRow, setEditingRow] = useState<CommsPlanRow | null>(null);
    const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({ name: '', subject: '', body: '' });
    const [templateSaving, setTemplateSaving] = useState(false);
    const [templateError, setTemplateError] = useState('');

    const load = useCallback(() => {
        setLoading(true);
        Promise.all([
            api.get('/comms-plan') as Promise<CommsPlanRow[]>,
            api.get('/comms-plan/metadata') as Promise<CommsPlanMetadataResponse>,
        ])
            .then(([planData, metadata]) => {
                setPlan(planData || []);
                setBatchSchedules(metadata?.batches || []);
                setMilestones(metadata?.milestones || []);
                setLoading(false);
            })
            .catch((err: Error) => {
                setError(err.message || 'Failed to load');
                setLoading(false);
            });
    }, []);

    useEffect(() => {
        if (!authed) return;
        load();
    }, [authed, load]);

    const toggle = async (stepKey: string, batchNumber: number, currentStatus: StepStatus['status']) => {
        const key = `${stepKey}:${batchNumber}`;
        setToggling(key);
        try {
            const nextStatus =
                currentStatus === 'pending'
                    ? 'done'
                    : currentStatus === 'done'
                        ? 'skipped'
                        : 'pending';

            await api.patch(`/comms-plan/${stepKey}/${batchNumber}`, { status: nextStatus });
            setPlan((prev) =>
                prev.map((row) => {
                    if (row.step.key !== stepKey) return row;
                    return {
                        ...row,
                        batches: {
                            ...row.batches,
                            [batchNumber]: {
                                ...row.batches[batchNumber],
                                status: nextStatus,
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

    const openTemplateEditor = (row: CommsPlanRow) => {
        setEditingRow(row);
        setTemplateDraft({
            name: row.template?.name || `${row.step.code} ${row.step.label}`,
            subject: row.template?.subject || '',
            body: row.template?.body || row.step.content,
        });
        setTemplateError('');
    };

    const closeTemplateEditor = () => {
        if (templateSaving) return;
        setEditingRow(null);
        setTemplateError('');
        setTemplateDraft({ name: '', subject: '', body: '' });
    };

    const saveTemplate = async () => {
        if (!editingRow) return;
        if (!previewTemplateBody(templateDraft.body)) {
            setTemplateError('Template text is required');
            return;
        }

        try {
            setTemplateSaving(true);
            const saved = await api.put(
                `/comms-plan/${editingRow.step.key}/template`,
                templateDraft,
            ) as CommsJourneyTemplate;

            setPlan((prev) =>
                prev.map((row) =>
                    row.step.key === editingRow.step.key
                        ? { ...row, template: saved }
                        : row,
                ),
            );
            closeTemplateEditor();
        } catch (err: any) {
            setTemplateError(err.message || 'Failed to save template');
        } finally {
            setTemplateSaving(false);
        }
    };

    const clearTemplate = async () => {
        if (!editingRow?.template) return;
        if (!confirm('Remove the stored template for this journey step?')) return;

        try {
            setTemplateSaving(true);
            await api.del(`/comms-plan/${editingRow.step.key}/template`);
            setPlan((prev) =>
                prev.map((row) =>
                    row.step.key === editingRow.step.key
                        ? { ...row, template: null }
                        : row,
                ),
            );
            closeTemplateEditor();
        } catch (err: any) {
            setTemplateError(err.message || 'Failed to remove template');
        } finally {
            setTemplateSaving(false);
        }
    };

    const exportExcel = async () => {
        try {
            setExporting(true);
            const blob = await api.downloadBlob('/comms-plan/export/excel', undefined, 'GET');
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Comms_Plan_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err: any) {
            setError(err.message || 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    const totalCells = useMemo(
        () => plan.reduce((acc, row) => acc + Object.values(row.batches).filter((cell) => cell.planned_date).length, 0),
        [plan],
    );
    const doneCells = useMemo(
        () => plan.reduce((acc, row) => acc + Object.values(row.batches).filter((cell) => cell.planned_date && cell.status === 'done').length, 0),
        [plan],
    );
    const skippedCells = useMemo(
        () => plan.reduce((acc, row) => acc + Object.values(row.batches).filter((cell) => cell.planned_date && cell.status === 'skipped').length, 0),
        [plan],
    );
    const completedPercent = totalCells > 0 ? Math.round(((doneCells + skippedCells) / totalCells) * 100) : 0;
    const hackathonDate = getMilestoneDate(milestones, 'hackathon_date');
    const hubPrioCutoffDate = getMilestoneDate(milestones, 'hub_prio_cutoff');

    if (!authed) return null;

    return (
        <AnimatedPage className="pb-20">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Communication Plan</h1>
                    <p className="text-sm text-dark-5">Mirror the workbook schedule, manage template text per journey step, and keep phase tracking clickable.</p>
                </div>
                <button
                    onClick={exportExcel}
                    disabled={exporting}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
                >
                    {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Export to Excel
                </button>
            </div>

            {error && (
                <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
                </div>
            )}

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

            <div className="flex items-center gap-4 mb-4 text-xs flex-wrap">
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-white border border-stroke/70 flex items-center justify-center text-dark-5">○</span>
                    Pending
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-green-light-7 border border-green/20 flex items-center justify-center text-green font-bold">✓</span>
                    Done
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-gray-2 border border-gray-3 flex items-center justify-center text-dark-5">⏭</span>
                    Skipped
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-white border border-primary/30 flex items-center justify-center text-primary font-bold text-[10px]">⚡</span>
                    Auto-detected
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-surface-2/60 flex items-center justify-center text-dark-6">-</span>
                    Not scheduled
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

            {loading ? (
                <div className="rounded-2xl bg-surface p-16 shadow-1 text-center border border-stroke/60">
                    <div className="animate-spin text-3xl mb-3">⟳</div>
                    <p className="text-dark-5 text-sm">Loading communication plan...</p>
                </div>
            ) : (
                <>
                    <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden mb-6">
                        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] p-4">
                            <table className="w-full text-sm border border-stroke/60 rounded-xl overflow-hidden">
                                <tbody>
                                    <tr className="border-b border-stroke/60">
                                        <th className="text-left px-4 py-3 bg-surface-2/50 text-dark font-medium">Hackathon Date</th>
                                        <td className="px-4 py-3 text-dark-5">{hackathonDate ? formatLongDate(hackathonDate) : '-'}</td>
                                    </tr>
                                    <tr>
                                        <th className="text-left px-4 py-3 bg-surface-2/50 text-dark font-medium">Hub prio cut-off</th>
                                        <td className="px-4 py-3 text-dark-5">{hubPrioCutoffDate ? formatLongDate(hubPrioCutoffDate) : '-'}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <div className="overflow-x-auto">
                                <table className="min-w-[540px] w-full text-sm border border-stroke/60 rounded-xl overflow-hidden">
                                    <thead className="bg-surface-2/50">
                                        <tr>
                                            <th className="text-left px-4 py-3 text-dark font-medium">Batch</th>
                                            <th className="text-left px-4 py-3 text-dark font-medium">Application Deadline</th>
                                            <th className="text-left px-4 py-3 text-dark font-medium">Comms Deadline decision</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {batchSchedules.map((batch) => (
                                            <tr key={batch.number} className="border-t border-stroke/40">
                                                <td className="px-4 py-3 text-dark">{batch.label}</td>
                                                <td className="px-4 py-3 text-dark-5">{formatLongDate(batch.applicationDeadline)}</td>
                                                <td className="px-4 py-3 text-dark-5">{formatLongDate(batch.commsDecisionDate)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[1680px]">
                                <thead>
                                    <tr className="bg-stroke/15 border-b border-stroke/60">
                                        <th colSpan={13} className="text-left px-4 py-3 text-dark font-semibold">Communication journey</th>
                                    </tr>
                                    <tr className="bg-surface-2/50">
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[110px]">Journey step</th>
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[170px]">Journey name</th>
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[280px]">Content</th>
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[280px]">Templates</th>
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[140px]">Personalization</th>
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[200px]">Who</th>
                                        {BATCH_NUMBERS.map((number) => (
                                            <th key={number} className="text-left px-3 py-3 text-dark-5 font-medium min-w-[122px]">{`When Batch ${number}`}</th>
                                        ))}
                                        <th className="text-left px-4 py-3 text-dark-5 font-medium min-w-[110px]">Global Luma</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {plan.map((row) => {
                                        const rowApplicable = Object.values(row.batches).filter((cell) => cell.planned_date).length;
                                        const rowClosed = Object.values(row.batches).filter((cell) => cell.planned_date && (cell.status === 'done' || cell.status === 'skipped')).length;
                                        const rowComplete = rowApplicable > 0 && rowClosed === rowApplicable;
                                        const templatePreview = row.template ? previewTemplateBody(row.template.body) : '';

                                        return (
                                            <tr
                                                key={row.step.key}
                                                className={`border-t border-stroke/40 align-top ${rowComplete ? 'opacity-70' : ''}`}
                                            >
                                                <td className="px-4 py-3 font-mono text-xs text-dark">{row.step.code}</td>
                                                <td className="px-4 py-3 text-dark font-medium">{row.step.label}</td>
                                                <td className="px-4 py-3 text-dark-5 whitespace-pre-line">{row.step.content}</td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        onClick={() => openTemplateEditor(row)}
                                                        className="w-full rounded-xl border border-stroke/60 bg-surface-2/40 px-3 py-3 text-left transition hover:border-primary/30 hover:bg-surface-2"
                                                    >
                                                        {row.template ? (
                                                            <>
                                                                <div className="font-medium text-dark truncate">{row.template.name}</div>
                                                                {row.template.subject ? (
                                                                    <div className="text-[11px] text-dark-6 mt-1 truncate">{row.template.subject}</div>
                                                                ) : null}
                                                                <div className="text-[11px] text-dark-5 mt-2 leading-5">
                                                                    {templatePreview || 'Template text stored'}
                                                                </div>
                                                                <div className="text-[11px] text-primary mt-2 font-medium">Edit template</div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div className="font-medium text-primary">Add template</div>
                                                                <div className="text-[11px] text-dark-6 mt-2">Store the message text for this journey step directly inside the plan.</div>
                                                            </>
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="inline-flex items-center rounded-xl border border-stroke/60 bg-surface-2 px-3 py-2 text-xs font-medium text-dark">
                                                        {buildPersonalizationLabel(row.step.templateType)}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-dark-5">{row.step.who}</td>
                                                {BATCH_NUMBERS.map((batchNumber) => {
                                                    const cell = row.batches[batchNumber];
                                                    if (!cell.planned_date) {
                                                        return (
                                                            <td key={batchNumber} className="px-3 py-3 text-dark-6">
                                                                -
                                                            </td>
                                                        );
                                                    }

                                                    const isToggling = toggling === `${row.step.key}:${batchNumber}`;
                                                    const isOverdue = cell.status === 'pending' && new Date(`${cell.planned_date}T23:59:59.999`) < new Date();
                                                    const statusStyle = statusStyles[cell.status];
                                                    const overdueTone = isOverdue
                                                        ? 'bg-red-light-6 border-red/20 text-red'
                                                        : statusStyle.tone;

                                                    return (
                                                        <td key={batchNumber} className="px-3 py-3">
                                                            <motion.button
                                                                whileHover={{ scale: 1.01 }}
                                                                whileTap={{ scale: 0.99 }}
                                                                onClick={() => toggle(row.step.key, batchNumber, cell.status)}
                                                                disabled={isToggling}
                                                                className={`relative w-full rounded-xl border px-3 py-3 text-left text-[11px] leading-4 transition ${overdueTone} ${isToggling ? 'opacity-50' : 'hover:shadow-sm'}`}
                                                                title={`${formatLongDate(cell.planned_date)} - ${isOverdue ? 'Missed deadline' : statusStyle.label}${cell.auto_detected ? ' - auto-detected' : ''} - click to change`}
                                                            >
                                                                <span className={`block font-medium ${isOverdue ? 'text-red' : statusStyle.accent}`}>
                                                                    {formatLongDate(cell.planned_date)}
                                                                </span>
                                                                {statusStyle.icon ? (
                                                                    <span className="absolute bottom-2 right-2 text-[11px]">{statusStyle.icon}</span>
                                                                ) : null}
                                                                {cell.auto_detected ? (
                                                                    <span className="absolute top-2 right-2 text-[10px] text-primary">⚡</span>
                                                                ) : null}
                                                            </motion.button>
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-4 py-3 text-dark-5">{row.step.globalLuma}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        {plan.map((row) => {
                            const applicableBatches = Object.values(row.batches).filter((cell) => cell.planned_date).length;
                            const doneBatches = Object.values(row.batches).filter((cell) => cell.planned_date && cell.status === 'done').length;
                            const skippedBatches = Object.values(row.batches).filter((cell) => cell.planned_date && cell.status === 'skipped').length;
                            const progress = applicableBatches > 0
                                ? Math.round(((doneBatches + skippedBatches) / applicableBatches) * 100)
                                : 0;

                            return (
                                <motion.div
                                    key={row.step.key}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: row.step.order * 0.03 }}
                                    className="rounded-xl bg-surface p-3 shadow-1 border border-stroke/40"
                                >
                                    <div className="flex items-center justify-between mb-2 gap-2">
                                        <span className="text-xs font-medium text-dark truncate">{row.step.label}</span>
                                        <span className={`text-xs font-bold ${progress === 100 ? 'text-green' : 'text-dark-5'}`}>{progress}%</span>
                                    </div>
                                    <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                                        <motion.div
                                            className={`h-full rounded-full ${progress === 100 ? 'bg-green' : 'bg-primary'}`}
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progress}%` }}
                                            transition={{ duration: 0.4, ease: 'easeOut' }}
                                        />
                                    </div>
                                    <div className="flex gap-1 mt-2">
                                        {BATCH_NUMBERS.map((batchNumber) => {
                                            const cell = row.batches[batchNumber];
                                            const color = !cell.planned_date
                                                ? 'bg-surface-2/40'
                                                : cell.status === 'done'
                                                    ? 'bg-green'
                                                    : cell.status === 'skipped'
                                                        ? 'bg-dark-5'
                                                        : 'bg-surface-2';
                                            return <div key={batchNumber} className={`flex-1 h-1 rounded-full ${color}`} />;
                                        })}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </>
            )}

            <AnimatePresence>
                {editingRow ? (
                    <motion.div
                        className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeTemplateEditor}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 18, scale: 0.98 }}
                            transition={{ duration: 0.18 }}
                            onClick={(event) => event.stopPropagation()}
                            className="w-full max-w-4xl rounded-2xl bg-surface border border-stroke/60 shadow-1 overflow-hidden"
                        >
                            <div className="px-6 py-4 border-b border-stroke/60 flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-dark-6">Template editor</p>
                                    <h2 className="text-lg font-semibold text-dark mt-1">{editingRow.step.code} {editingRow.step.label}</h2>
                                    <p className="text-sm text-dark-5 mt-1">{editingRow.step.content}</p>
                                </div>
                                <button
                                    onClick={closeTemplateEditor}
                                    className="text-dark-6 hover:text-dark transition-colors"
                                    type="button"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
                                {templateError ? (
                                    <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm">
                                        {templateError}
                                    </div>
                                ) : null}

                                <div className="grid md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-dark-5 uppercase tracking-wider mb-2">Template name</label>
                                        <input
                                            value={templateDraft.name}
                                            onChange={(event) => setTemplateDraft((prev) => ({ ...prev, name: event.target.value }))}
                                            className="w-full border border-stroke rounded-xl px-4 py-3 text-sm outline-none transition focus:border-primary bg-surface-2"
                                            placeholder="Accepted template"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-dark-5 uppercase tracking-wider mb-2">Subject</label>
                                        <input
                                            value={templateDraft.subject}
                                            onChange={(event) => setTemplateDraft((prev) => ({ ...prev, subject: event.target.value }))}
                                            className="w-full border border-stroke rounded-xl px-4 py-3 text-sm outline-none transition focus:border-primary bg-surface-2"
                                            placeholder="Optional email subject"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-dark-5 uppercase tracking-wider mb-2">Template text</label>
                                    <RichTextEditor
                                        content={templateDraft.body}
                                        onChange={(body) => setTemplateDraft((prev) => ({ ...prev, body }))}
                                        minHeight="260px"
                                    />
                                </div>
                            </div>

                            <div className="px-6 py-4 border-t border-stroke/60 flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={clearTemplate}
                                    disabled={!editingRow.template || templateSaving}
                                    className="text-sm text-red hover:text-red/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Remove template
                                </button>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={closeTemplateEditor}
                                        className="px-4 py-2 text-sm text-dark-5 hover:text-dark transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveTemplate}
                                        disabled={templateSaving}
                                        className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {templateSaving ? 'Saving...' : 'Save template'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </AnimatedPage>
    );
}
