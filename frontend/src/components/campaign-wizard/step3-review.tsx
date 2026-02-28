'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';

type ListItem = { id: number; name: string; type: string };
type Attachment = { filename: string; originalName: string; mimeType: string };

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
  onSend: (scheduledAt: string | null) => void;
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
          disabled={!canSend || (scheduleMode === 'later' && !scheduledAt)}
          whileHover={canSend ? { scale: 1.03 } : {}}
          whileTap={canSend ? { scale: 0.97 } : {}}
          onClick={() => onSend(scheduleMode === 'later' ? scheduledAt : null)}
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
