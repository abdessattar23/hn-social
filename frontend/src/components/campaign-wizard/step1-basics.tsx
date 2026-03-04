'use client';
import { motion } from 'framer-motion';

type Template = { id: number; name: string; type: string };
type Account = { id: string; type: string; name?: string };

interface Step1Props {
  name: string;
  onNameChange: (name: string) => void;
  templates: Template[];
  selectedTemplateId: number | '';
  onTemplateChange: (id: number) => void;
  accounts: Account[];
  aliases?: Record<string, string>;
  accountId: string;
  onAccountChange: (id: string) => void;
  onNext: () => void;
}

const EMAIL_ACCOUNT_TYPES = ['MAIL', 'GOOGLE', 'GOOGLE_OAUTH', 'IMAP', 'OUTLOOK'];
const LINKEDIN_ACCOUNT_TYPES = ['LINKEDIN', 'LINKEDIN_OAUTH'];

export default function Step1Basics({
  name, onNameChange,
  templates, selectedTemplateId, onTemplateChange,
  accounts, aliases = {}, accountId, onAccountChange,
  onNext,
}: Step1Props) {
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const filteredAccounts = selectedTemplate
    ? accounts.filter((a) =>
        selectedTemplate.type === 'EMAIL'
          ? EMAIL_ACCOUNT_TYPES.includes(a.type)
          : selectedTemplate.type === 'LINKEDIN'
          ? LINKEDIN_ACCOUNT_TYPES.includes(a.type)
          : a.type === 'WHATSAPP'
      )
    : accounts;

  const canProceed = name.trim() && selectedTemplateId && accountId;

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
      <h3 className="text-base font-semibold text-dark mb-1">Campaign Basics</h3>
      <p className="text-xs text-dark-5 mb-5">Choose a name, template, and sending account.</p>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-dark mb-1.5">Campaign Name</label>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. February Newsletter"
            className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none transition-all duration-200 focus:border-primary bg-surface-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-dark mb-1.5">Template</label>
          <select
            value={selectedTemplateId}
            onChange={(e) => {
              onTemplateChange(Number(e.target.value));
              onAccountChange('');
            }}
            className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface transition-all duration-200 focus:border-primary"
          >
            <option value="">Select a template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-dark mb-1.5">Send from Account</label>
          <select
            value={accountId}
            onChange={(e) => onAccountChange(e.target.value)}
            className="w-full border border-stroke rounded-xl px-5 py-3 text-sm outline-none bg-surface transition-all duration-200 focus:border-primary"
          >
            <option value="">Select an account...</option>
            {filteredAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {aliases[a.id] || a.name || a.id} ({a.type})
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end pt-2">
          <motion.button
            type="button"
            disabled={!canProceed}
            whileHover={canProceed ? { scale: 1.03 } : {}}
            whileTap={canProceed ? { scale: 0.97 } : {}}
            onClick={onNext}
            className="bg-primary hover:bg-accent text-white rounded-xl px-8 py-3 text-sm font-medium disabled:opacity-50 transition-opacity"
          >
            Next
          </motion.button>
        </div>
      </div>
    </div>
  );
}
