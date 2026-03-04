'use client';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';

type ListItem = { id: number; name: string; type: string };
type Attachment = { filename: string; originalName: string; mimeType: string };

const CHANNEL_DELAY_DEFAULTS: Record<string, { min: number; max: number; label: string }> = {
  EMAIL: { min: 0.2, max: 1, label: '0.2-1s (Email)' },
  WHATSAPP: { min: 3, max: 8, label: '3-8s (WhatsApp)' },
  LINKEDIN: { min: 3, max: 8, label: '3-8s (LinkedIn)' },
};

interface Step3Props {
  campaignName: string;
  templateName: string;
  templateType: string;
  accountName: string;
  subject: string;
  body: string;
  signature?: string;
  attachments?: Attachment[];
  lists: ListItem[];
  selectedLists: Set<number>;
  onToggleList: (id: number) => void;
  onBack: () => void;
  onSend: (scheduledAt: string | null, delayMinMs: number, delayMaxMs: number) => void;
  sending: boolean;
  error: string;
}

export default function Step3Review({
  campaignName, templateName, templateType, accountName,
  subject, body, signature, attachments, lists, selectedLists, onToggleList,
  onBack, onSend, sending, error,
}: Step3Props) {
  const filteredLists = lists.filter((l) => l.type === templateType);
  const canSend = selectedLists.size > 0 && !sending;

  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSpeed, setShowSpeed] = useState(false);

  const defaults = CHANNEL_DELAY_DEFAULTS[templateType] || CHANNEL_DELAY_DEFAULTS.EMAIL;
  const [delayMin, setDelayMin] = useState(defaults.min);
  const [delayMax, setDelayMax] = useState(defaults.max);

  const delayError = delayMin > delayMax ? 'Min must be less than or equal to max' : '';

  const totalContacts = useMemo(() => {
    return filteredLists.filter((l) => selectedLists.has(l.id)).length * 100;
  }, [filteredLists, selectedLists]);

  const etaText = useMemo(() => {
    if (selectedLists.size === 0) return '';
    const avgDelay = (delayMin + delayMax) / 2;
    const n = totalContacts || selectedLists.size;
    const totalSeconds = n * avgDelay;
    if (totalSeconds < 60) return `~${Math.round(totalSeconds)}s`;
    if (totalSeconds < 3600) return `~${Math.round(totalSeconds / 60)} min`;
    const hours = totalSeconds / 3600;
    return `~${hours.toFixed(1)} hours`;
  }, [delayMin, delayMax, totalContacts, selectedLists.size]);

  return (
    <div className="space-y-6">
      {/* List selection */}
      <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
        <label className="block text-sm font-medium text-dark mb-3">
          Select Lists ({templateType} only)
        </label>
        {filteredLists.length === 0 ? (
          <p className="text-dark-6 text-sm">No {templateType} lists available.</p>
        ) : (
          <div className="space-y-1.5">
            {filteredLists.map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-2 px-4 py-3 rounded-xl border border-stroke cursor-pointer hover:bg-primary/5 text-sm transition-all duration-200"
              >
                <input
                  type="checkbox"
                  checked={selectedLists.has(l.id)}
                  onChange={() => onToggleList(l.id)}
                  className="accent-primary"
                />
                <span className="text-dark">{l.name}</span>
                <span
                  className={`ml-auto px-2.5 py-1 rounded-md text-xs font-medium ${
                    l.type === 'EMAIL' ? 'bg-blue-light-5 text-blue' : l.type === 'WHATSAPP' ? 'bg-green-light-7 text-green' : 'bg-linkedin-light text-linkedin'
                  }`}
                >
                  {l.type}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Review summary */}
      <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
        <h3 className="text-sm font-medium text-dark mb-4">Review Summary</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-dark-5">Campaign</span>
            <span className="text-dark font-medium">{campaignName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-dark-5">Template</span>
            <div className="flex items-center gap-2">
              <span className="text-dark font-medium">{templateName}</span>
              <span
                className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                  templateType === 'EMAIL' ? 'bg-blue-light-5 text-blue' : templateType === 'WHATSAPP' ? 'bg-green-light-7 text-green' : 'bg-linkedin-light text-linkedin'
                }`}
              >
                {templateType}
              </span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-dark-5">Account</span>
            <span className="text-dark font-medium">{accountName}</span>
          </div>
          {templateType === 'EMAIL' && subject && (
            <div className="flex justify-between">
              <span className="text-dark-5">Subject</span>
              <span className="text-dark font-medium">{subject}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-dark-5">Lists</span>
            <span className="text-dark font-medium">
              {selectedLists.size === 0 ? 'None selected' : `${selectedLists.size} selected`}
            </span>
          </div>
        </div>

        {/* Body preview */}
        <div className="mt-4 pt-4 border-t border-stroke">
          <span className="text-sm text-dark-5 block mb-2">Content Preview</span>
          <div className="rounded-lg border border-stroke p-4 max-h-48 overflow-y-auto text-sm">
            {templateType === 'EMAIL' ? (
              <div dangerouslySetInnerHTML={{ __html: body + (signature ? '<br/><br/>--<br/>' + signature : '') }} />
            ) : (
              <pre className="whitespace-pre-wrap">{body}</pre>
            )}
          </div>
        </div>

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mt-4 pt-4 border-t border-stroke">
            <span className="text-sm text-dark-5 block mb-2">Attachments ({attachments.length})</span>
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span key={a.filename} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-xs text-dark">
                  <svg className="w-3.5 h-3.5 text-dark-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                  </svg>
                  {a.originalName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Schedule toggle */}
      <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
        <label className="block text-sm font-medium text-dark mb-3">When to send</label>
        <div className="flex gap-3 mb-4">
          <button
            type="button"
            onClick={() => setScheduleMode('now')}
            className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200 ${
              scheduleMode === 'now'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-stroke text-dark-5 hover:bg-surface-2'
            }`}
          >
            Send Now
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode('later')}
            className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200 ${
              scheduleMode === 'later'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-stroke text-dark-5 hover:bg-surface-2'
            }`}
          >
            Schedule for Later
          </button>
        </div>
        {scheduleMode === 'later' && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full rounded-lg border border-stroke px-4 py-3 text-sm text-dark focus:border-primary focus:outline-none bg-surface-2"
          />
        )}
      </div>

      {/* Sending Speed */}
      <div className="rounded-2xl bg-surface shadow-1 border border-stroke/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSpeed(!showSpeed)}
          className="w-full flex items-center justify-between p-6 text-left"
        >
          <div>
            <span className="text-sm font-medium text-dark">Sending Speed</span>
            <span className="text-xs text-dark-5 ml-2">
              {delayMin}s - {delayMax}s delay between sends
            </span>
          </div>
          <svg className={`w-4 h-4 text-dark-5 transition-transform ${showSpeed ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {showSpeed && (
          <div className="px-6 pb-6 space-y-4 border-t border-stroke/60 pt-4">
            <p className="text-xs text-dark-5">
              Humanized random delay between each send. Recommended: {defaults.label}.
              {templateType !== 'EMAIL' && ' Lower values risk account restrictions.'}
            </p>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs text-dark-5 mb-1 font-medium">Min delay (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  value={delayMin}
                  onChange={(e) => setDelayMin(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-dark-5 mb-1 font-medium">Max delay (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  value={delayMax}
                  onChange={(e) => setDelayMax(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full border border-stroke bg-surface-2 rounded-xl px-4 py-2.5 text-sm text-dark outline-none focus:border-primary transition-all duration-200"
                />
              </div>
            </div>
            {delayError && <p className="text-red text-xs">{delayError}</p>}
            {etaText && selectedLists.size > 0 && (
              <p className="text-xs text-dark-5">
                Estimated sending time: <span className="text-dark font-medium">{etaText}</span>
              </p>
            )}
            <div className="flex gap-2">
              {Object.entries(CHANNEL_DELAY_DEFAULTS).map(([key, val]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setDelayMin(val.min); setDelayMax(val.max); }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                    delayMin === val.min && delayMax === val.max
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-stroke text-dark-5 hover:bg-surface-2'
                  }`}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-red text-sm">{error}</p>}

      <div className="flex justify-between">
        <motion.button
          type="button"
          onClick={onBack}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="bg-surface-2 text-dark-5 rounded-xl px-6 py-3 text-sm font-medium hover:bg-surface-3 transition-colors"
        >
          Back
        </motion.button>
        <motion.button
          type="button"
          disabled={!canSend || !!delayError || (scheduleMode === 'later' && !scheduledAt)}
          whileHover={canSend ? { scale: 1.03 } : {}}
          whileTap={canSend ? { scale: 0.97 } : {}}
          onClick={() => onSend(
            scheduleMode === 'later' ? scheduledAt : null,
            Math.round(delayMin * 1000),
            Math.round(delayMax * 1000),
          )}
          className="bg-primary hover:bg-accent text-white rounded-xl px-8 py-3 text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          {sending
            ? scheduleMode === 'later' ? 'Scheduling...' : 'Sending...'
            : scheduleMode === 'later' ? 'Schedule Campaign' : 'Create & Send Campaign'}
        </motion.button>
      </div>
    </div>
  );
}
