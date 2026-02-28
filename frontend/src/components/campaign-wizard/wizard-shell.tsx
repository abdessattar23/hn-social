'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import StepIndicator from './step-indicator';
import Step1Basics from './step1-basics';
import Step2Editor from './step2-editor';
import Step3Review from './step3-review';
import { AnimatedPage } from '@/components/motion';
import { motion, AnimatePresence } from 'framer-motion';

type Attachment = { filename: string; originalName: string; mimeType: string; path: string };
type Template = { id: number; name: string; type: string; subject?: string; body?: string; attachments?: Attachment[] };
type ListItem = { id: number; name: string; type: string };
type Account = { id: string; type: string; name?: string };

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

export default function WizardShell() {
  const { authed } = useRequireAuth();
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [lists, setLists] = useState<ListItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});

  const [campaignName, setCampaignName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [accountId, setAccountId] = useState('');

  const [editableBody, setEditableBody] = useState('');
  const [editableSubject, setEditableSubject] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [selectedLists, setSelectedLists] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authed) return;
    Promise.all([
      api.get('/messages'),
      api.get('/lists'),
      api.get('/unipile/accounts'),
      api.get('/org/account-aliases'),
      api.get('/org/account-signatures'),
    ]).then(([msgs, lsts, accs, als, sigs]) => {
      setTemplates(msgs);
      setLists(lsts);
      setAccounts(accs.items || accs || []);
      setAliases(als || {});
      setSignatures(sigs || {});
    }).catch(() => {});
  }, [authed]);

  const goTo = (s: number) => {
    setDirection(s > step ? 1 : -1);
    setStep(s);
  };

  const handleTemplateChange = async (id: number) => {
    setSelectedTemplateId(id);
    setSelectedLists(new Set());
    try {
      const full: Template = await api.get(`/messages/${id}`);
      setEditableBody(full.body || '');
      setEditableSubject(full.subject || '');
      setAttachments(full.attachments || []);
    } catch {
      setEditableBody(''); setEditableSubject(''); setAttachments([]);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const templateType = (selectedTemplate?.type || 'EMAIL') as 'EMAIL' | 'WHATSAPP';
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const accountName = selectedAccount ? (aliases[selectedAccount.id] || selectedAccount.name || selectedAccount.id) : '';
  const accountSignature = accountId ? (signatures[accountId] || '') : '';

  const toggleList = (id: number) => {
    const next = new Set(selectedLists);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedLists(next);
  };

  const handleSend = async (scheduledAt: string | null) => {
    if (!selectedTemplateId || selectedLists.size === 0 || !accountId) return;
    setError(''); setSending(true);
    try {
      const copyTemplate = await api.post('/messages', {
        name: `${campaignName} - Copy`, type: templateType,
        subject: templateType === 'EMAIL' ? editableSubject : undefined,
        body: editableBody, attachments,
      });
      const campaign = await api.post('/campaigns', {
        name: campaignName, messageId: copyTemplate.id,
        listIds: [...selectedLists], accountId,
        ...(scheduledAt ? { scheduledAt } : {}),
      });
      if (!scheduledAt) await api.post(`/campaigns/${campaign.id}/send`);
      window.location.href = '/campaigns';
    } catch (err: any) {
      setError(err.message || 'Failed to create campaign');
    } finally { setSending(false); }
  };

  if (!authed) return <div className="text-dark-5 text-sm p-4">Loading...</div>;

  return (
    <AnimatedPage>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <a href="/campaigns" className="text-dark-5 hover:text-dark transition-colors p-1 -ml-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </a>
          <div>
            <h1 className="text-xl font-bold text-dark">New Campaign</h1>
            <p className="text-sm text-dark-5">Set up and launch your campaign in 3 steps.</p>
          </div>
        </div>

        <StepIndicator currentStep={step} />

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] as const }}
          >
            {step === 1 && (
              <Step1Basics
                name={campaignName} onNameChange={setCampaignName}
                templates={templates} selectedTemplateId={selectedTemplateId} onTemplateChange={handleTemplateChange}
                accounts={accounts} aliases={aliases} accountId={accountId} onAccountChange={setAccountId}
                onNext={() => goTo(2)}
              />
            )}
            {step === 2 && (
              <Step2Editor
                key={selectedTemplateId}
                templateType={templateType} body={editableBody} onBodyChange={setEditableBody}
                subject={editableSubject} onSubjectChange={setEditableSubject}
                attachments={attachments}
                onUploadAttachment={async (file) => { const form = new FormData(); form.append('file', file); const att = await api.upload('/messages/upload-attachment', form); setAttachments((p) => [...p, att]); }}
                onRemoveAttachment={(f) => setAttachments((p) => p.filter((a) => a.filename !== f))}
                signature={accountSignature}
                onBack={() => goTo(1)} onNext={() => goTo(3)}
              />
            )}
            {step === 3 && (
              <Step3Review
                campaignName={campaignName} templateName={selectedTemplate?.name || ''}
                templateType={templateType} accountName={accountName}
                subject={editableSubject} body={editableBody} signature={accountSignature}
                attachments={attachments} lists={lists} selectedLists={selectedLists}
                onToggleList={toggleList} onBack={() => goTo(2)} onSend={handleSend}
                sending={sending} error={error}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </AnimatedPage>
  );
}
