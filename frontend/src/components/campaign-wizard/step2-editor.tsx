'use client';
import TipTapEditor from './tiptap-editor';
import WhatsAppEditor from './whatsapp-editor';
import { motion } from 'framer-motion';

type Attachment = { filename: string; originalName: string; mimeType: string };

interface Step2Props {
  templateType: 'EMAIL' | 'WHATSAPP';
  body: string;
  onBodyChange: (body: string) => void;
  subject: string;
  onSubjectChange: (subject: string) => void;
  attachments?: Attachment[];
  onUploadAttachment?: (file: File) => Promise<void>;
  onRemoveAttachment?: (filename: string) => void;
  signature?: string;
  onBack: () => void;
  onNext: () => void;
}

export default function Step2Editor({
  templateType, body, onBodyChange, subject, onSubjectChange,
  attachments, onUploadAttachment, onRemoveAttachment,
  signature, onBack, onNext,
}: Step2Props) {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadAttachment) return;
    await onUploadAttachment(file);
    e.target.value = '';
  };

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
      <p className="text-sm text-dark-5 mb-4">
        Changes here won&apos;t affect the original template.
      </p>

      {templateType === 'EMAIL' ? (
        <TipTapEditor
          content={body}
          onChange={onBodyChange}
          subject={subject}
          onSubjectChange={onSubjectChange}
        />
      ) : (
        <WhatsAppEditor content={body} onChange={onBodyChange} />
      )}

      {signature && templateType === 'EMAIL' && (
        <div className="mt-4 pt-4 border-t border-stroke">
          <p className="text-xs font-medium text-dark-5 uppercase tracking-wider mb-2">Signature</p>
          <div className="rounded-lg border border-stroke bg-gray-1/50 p-4 text-sm" dangerouslySetInnerHTML={{ __html: signature }} />
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-stroke">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-medium text-dark-5 uppercase tracking-wider">Attachments</p>
          <label className="text-xs text-primary hover:text-primary/80 cursor-pointer transition-colors">
            + Add
            <input type="file" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
        {attachments && attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span key={a.filename} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-1 text-xs text-dark">
                <svg className="w-3.5 h-3.5 text-dark-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                </svg>
                {a.originalName}
                {onRemoveAttachment && (
                  <button onClick={() => onRemoveAttachment(a.filename)} className="ml-1 text-dark-5 hover:text-red transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-dark-6 text-xs">No attachments</p>
        )}
      </div>

      <div className="flex justify-between pt-5">
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
          onClick={onNext}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="bg-primary hover:bg-accent text-white rounded-xl px-8 py-3 text-sm font-medium transition-opacity"
        >
          Next
        </motion.button>
      </div>
    </div>
  );
}
