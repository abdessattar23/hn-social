'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/toast';
import { AnimatedPage, StaggerContainer, StaggerItem, SlideDown } from '@/components/motion';
import { motion } from 'framer-motion';

type Account = { id: string; type: string; name?: string; status?: string };

const WHATSAPP_TYPES = ['WHATSAPP'];
const LINKEDIN_TYPES = ['LINKEDIN', 'LINKEDIN_OAUTH'];
const EMAIL_ACCOUNT_TYPES = ['MAIL', 'GOOGLE', 'GOOGLE_OAUTH', 'IMAP', 'OUTLOOK'];

const EMAIL_PROVIDERS = [
  {
    type: 'GOOGLE', label: 'Google', icon: (active: boolean) => (
      <svg className={`w-4 h-4 ${active ? 'text-blue' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    )
  },
  {
    type: 'OUTLOOK', label: 'Outlook', icon: (active: boolean) => (
      <svg className={`w-4 h-4 ${active ? 'text-blue' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08l1.426 1.062c.127.096.27.144.43.144.16 0 .304-.048.43-.144L24 8.424v-.004l-.002-.033zM23.184 6.33c-.004.015-.013.038-.03.068a.588.588 0 0 1-.174.18l-6.07 4.544-6.073-4.544a.588.588 0 0 1-.173-.18c-.017-.03-.027-.053-.03-.068h12.55zM14.924 18.67H.816c-.226 0-.418-.077-.578-.23A.787.787 0 0 1 0 17.864V5.862c0-.225.08-.42.238-.574a.788.788 0 0 1 .578-.23h4.537v5.58l-.03.053c-.498.862-.748 1.817-.748 2.864 0 1.31.442 2.48 1.328 3.512.886 1.034 1.98 1.636 3.283 1.808.184.024.356.036.517.036.97 0 1.85-.278 2.64-.835.79-.558 1.36-1.297 1.707-2.22h.874v3.815zm-5.172-2.746c-.81 0-1.502-.31-2.076-.927-.575-.62-.862-1.36-.862-2.224 0-.863.287-1.605.862-2.224a2.727 2.727 0 0 1 2.076-.928c.81 0 1.502.31 2.076.928.574.619.862 1.361.862 2.224 0 .864-.288 1.605-.862 2.224a2.727 2.727 0 0 1-2.076.927z" />
      </svg>
    )
  },
  {
    type: 'MAIL', label: 'Other (IMAP)', icon: (active: boolean) => (
      <svg className={`w-4 h-4 ${active ? 'text-blue' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    )
  },
];

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { authed } = useRequireAuth();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [editingSignature, setEditingSignature] = useState<string | null>(null);
  const [signatureInput, setSignatureInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [emailDropdownOpen, setEmailDropdownOpen] = useState(false);
  const [dailySendLimit, setDailySendLimit] = useState<number | null>(null);
  const [sendLimitInput, setSendLimitInput] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);

  useEffect(() => {
    if (!authed) return;
    const isOAuthCallback = searchParams.get('unipile_connected') === '1';
    const callbackAccountId = searchParams.get('account_id');
    if (isOAuthCallback) {
      const registerAccount = callbackAccountId
        ? api.post('/unipile/register-callback', { accountId: callbackAccountId })
        : api.post('/unipile/adopt-new-accounts');

      registerAccount
        .then(() => {
          showToast('Account connected successfully!');
          loadAccounts();
        })
        .catch(() => loadAccounts())
        .finally(() => {
          router.replace('/settings', { scroll: false });
        });
      loadAliases(); loadSignatures(); loadSendLimit();
    } else {
      loadAccounts(); loadAliases(); loadSignatures(); loadSendLimit();
    }
  }, [authed]);

  const loadAccounts = async () => { try { const d = await api.get('/unipile/accounts'); setAccounts(d.items || d || []); } catch (err: any) { setPageError(err.message || 'Failed to load accounts'); } };
  const loadAliases = async () => { try { const d = await api.get('/org/account-aliases'); setAliases(d || {}); } catch (err: any) { setPageError(err.message || 'Failed to load aliases'); } };
  const saveAlias = async (accountId: string) => { try { const d = await api.patch('/org/account-alias', { accountId, alias: aliasInput.trim() }); setAliases(d || {}); setEditingAlias(null); } catch (err: any) { setPageError(err.message || 'Failed to save alias'); } };
  const loadSignatures = async () => { try { const d = await api.get('/org/account-signatures'); setSignatures(d || {}); } catch (err: any) { setPageError(err.message || 'Failed to load signatures'); } };
  const saveSignature = async (accountId: string) => { try { const d = await api.patch('/org/account-signature', { accountId, signature: signatureInput }); setSignatures(d || {}); setEditingSignature(null); } catch (err: any) { setPageError(err.message || 'Failed to save signature'); } };
  const disconnectAccount = async (accountId: string, name: string) => { if (!confirm(`Disconnect "${name}"?`)) return; try { await api.del(`/unipile/accounts/${accountId}`); loadAccounts(); } catch (e: any) { alert(e.message); } };
  const loadSendLimit = async () => {
    try {
      const d = await api.get('/org/send-limit');
      setDailySendLimit(d.dailySendLimit);
      setSendLimitInput(d.dailySendLimit ? String(d.dailySendLimit) : '');
    } catch (err: any) { setPageError(err.message || 'Failed to load send limit'); }
  };
  const saveSendLimit = async () => {
    setSavingLimit(true);
    try {
      const value = sendLimitInput.trim() === '' ? null : Number(sendLimitInput);
      if (value !== null && (isNaN(value) || value < 1)) {
        showToast('Enter a valid number or leave empty for unlimited.');
        setSavingLimit(false);
        return;
      }
      const d = await api.patch('/org/send-limit', { dailySendLimit: value });
      setDailySendLimit(d.dailySendLimit);
      showToast(value ? `Daily send limit set to ${value}` : 'Daily send limit removed');
    } catch (err: any) { setPageError(err.message || 'Failed to save send limit'); }
    finally { setSavingLimit(false); }
  };

  const hasWhatsApp = accounts.some((a) => WHATSAPP_TYPES.includes(a.type));
  const hasLinkedIn = accounts.some((a) => LINKEDIN_TYPES.includes(a.type));
  const hasEmail = accounts.some((a) => EMAIL_ACCOUNT_TYPES.includes(a.type));

  const connectAccount = async (type: string) => {
    if (type === 'WHATSAPP' && hasWhatsApp) {
      showToast('WhatsApp account already connected. Disconnect the existing one first.');
      return;
    }
    if (type === 'LINKEDIN' && hasLinkedIn) {
      showToast('LinkedIn account already connected. Disconnect the existing one first.');
      return;
    }
    setLoading(true);
    setEmailDropdownOpen(false);
    try {
      const data = await api.post('/unipile/connect', { type });
      const url = data.url || data.link;
      if (url) window.open(url, '_blank'); else alert('Could not get connection link.');
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };

  if (!authed) return null;

  return (
    <AnimatedPage>
      <h1 className="text-2xl font-bold text-dark mb-1 tracking-tight">Settings</h1>
      <p className="text-sm text-dark-5 mb-8">Manage your connected accounts.</p>

      {pageError && (
        <div className="bg-red-light-6 border border-red/20 text-red rounded-xl px-4 py-3 text-sm mb-4 flex items-center justify-between max-w-2xl">
          <span>{pageError}</span>
          <button onClick={() => setPageError('')} className="text-red hover:text-red/80 ml-3 shrink-0">&times;</button>
        </div>
      )}

      <StaggerContainer className="max-w-2xl space-y-6" staggerDelay={0.08}>
        {/* Connect Accounts */}
        <StaggerItem>
          <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
            <h2 className="text-base font-semibold text-dark mb-1">Accounts</h2>
            <p className="text-sm text-dark-5 mb-5">Connect your messaging and email accounts to start sending.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`border rounded-2xl p-5 transition-all duration-200 ${hasWhatsApp ? 'border-green/30 bg-green/[0.03]' : 'border-stroke'}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasWhatsApp ? 'bg-green/10' : 'bg-surface-2'}`}>
                    <svg className={`w-4 h-4 ${hasWhatsApp ? 'text-green' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 0 0 .611.611l4.458-1.495A11.96 11.96 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.592-.826-6.328-2.207l-.14-.114-3.292 1.103 1.103-3.293-.114-.14A9.935 9.935 0 0 1 2 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-dark">WhatsApp</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${hasWhatsApp ? 'bg-green' : 'bg-dark-6'}`} />
                      <p className="text-xs text-dark-5">{hasWhatsApp ? 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => connectAccount('WHATSAPP')}
                  disabled={loading || hasWhatsApp}
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${hasWhatsApp
                      ? 'bg-green/10 text-green cursor-default'
                      : 'bg-green text-white hover:opacity-90 disabled:opacity-50'
                    }`}
                >
                  {hasWhatsApp ? 'Connected' : 'Connect WhatsApp'}
                </motion.button>
              </div>

              <div className={`border rounded-2xl p-5 transition-all duration-200 ${hasLinkedIn ? 'border-linkedin/30 bg-linkedin/[0.03]' : 'border-stroke'}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasLinkedIn ? 'bg-linkedin/10' : 'bg-surface-2'}`}>
                    <svg className={`w-4 h-4 ${hasLinkedIn ? 'text-linkedin' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-dark">LinkedIn</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${hasLinkedIn ? 'bg-linkedin' : 'bg-dark-6'}`} />
                      <p className="text-xs text-dark-5">{hasLinkedIn ? 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => connectAccount('LINKEDIN')}
                  disabled={loading || hasLinkedIn}
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${hasLinkedIn
                      ? 'bg-linkedin/10 text-linkedin cursor-default'
                      : 'bg-linkedin text-white hover:opacity-90 disabled:opacity-50'
                    }`}
                >
                  {hasLinkedIn ? 'Connected' : 'Connect LinkedIn'}
                </motion.button>
              </div>
              <div className={`border rounded-2xl p-5 transition-all duration-200 relative ${hasEmail ? 'border-blue/30 bg-blue/[0.03]' : 'border-stroke'}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasEmail ? 'bg-blue/10' : 'bg-surface-2'}`}>
                    <svg className={`w-4 h-4 ${hasEmail ? 'text-blue' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-dark">Email</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${hasEmail ? 'bg-blue' : 'bg-dark-6'}`} />
                      <p className="text-xs text-dark-5">{hasEmail ? 'Connected' : 'Not connected'}</p>
                    </div>
                  </div>
                </div>
                {hasEmail ? (
                  <div className="w-full rounded-xl px-4 py-2.5 text-sm font-medium bg-blue/10 text-blue text-center cursor-default">
                    Connected
                  </div>
                ) : (
                  <div className="relative">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setEmailDropdownOpen(!emailDropdownOpen)}
                      disabled={loading}
                      className="w-full rounded-xl px-4 py-2.5 text-sm font-medium bg-blue text-white hover:opacity-90 disabled:opacity-50 transition-all duration-200 flex items-center justify-center gap-1.5"
                    >
                      Connect Email
                      <svg className={`w-3.5 h-3.5 transition-transform ${emailDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </motion.button>
                    {emailDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-stroke rounded-xl shadow-card-2 overflow-hidden z-10"
                      >
                        {EMAIL_PROVIDERS.map((p) => (
                          <button
                            key={p.type}
                            onClick={() => connectAccount(p.type)}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-dark hover:bg-surface-2 transition-colors"
                          >
                            {p.icon(false)}
                            {p.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={loadAccounts} className="text-xs text-dark-5 hover:text-dark transition-colors">
                Refresh accounts
              </motion.button>
            </div>
          </div>
        </StaggerItem>

        {/* Connected Account Details */}
        {accounts.length > 0 && (
          <StaggerItem>
            <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
              <h2 className="text-base font-semibold text-dark mb-4">Connected Account Details</h2>
              <div className="space-y-2">
                {accounts.map((a) => {
                  const isEmail = ['MAIL', 'GOOGLE', 'GOOGLE_OAUTH', 'IMAP', 'OUTLOOK'].includes(a.type);
                  return (
                    <motion.div key={a.id} layout className="border border-stroke rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-3.5">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${WHATSAPP_TYPES.includes(a.type) ? 'bg-green-light-7 text-green'
                            : LINKEDIN_TYPES.includes(a.type) ? 'bg-linkedin-light text-linkedin'
                              : isEmail ? 'bg-blue-light-5 text-blue'
                                : 'bg-surface-2 text-dark-5'
                          }`}>{a.type}</span>
                        <div className="flex-1 min-w-0">
                          {editingAlias === a.id ? (
                            <div className="flex items-center gap-2">
                              <input value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(a.id); if (e.key === 'Escape') setEditingAlias(null); }} placeholder="e.g. My WhatsApp" autoFocus className="flex-1 border border-stroke rounded-xl px-3 py-1.5 text-sm outline-none focus:border-primary bg-surface-2 transition-all duration-200" />
                              <button onClick={() => saveAlias(a.id)} className="text-xs text-primary font-medium hover:underline">Save</button>
                              <button onClick={() => setEditingAlias(null)} className="text-xs text-dark-5 hover:text-dark transition-colors">Cancel</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-dark font-medium truncate">{aliases[a.id] || a.name || a.id}</span>
                              {aliases[a.id] && <span className="text-xs text-dark-6 truncate">{a.name || a.id}</span>}
                              <button onClick={() => { setEditingAlias(a.id); setAliasInput(aliases[a.id] || ''); }} className="text-xs text-primary hover:underline shrink-0">Rename</button>
                              {isEmail && (
                                <button
                                  onClick={() => { editingSignature === a.id ? setEditingSignature(null) : (setEditingSignature(a.id), setSignatureInput(signatures[a.id] || '')); }}
                                  className="text-xs text-primary hover:underline shrink-0"
                                >
                                  {signatures[a.id] ? 'Edit Signature' : 'Add Signature'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {a.status && <span className="text-xs text-dark-6 shrink-0">{a.status}</span>}
                        <button onClick={() => disconnectAccount(a.id, aliases[a.id] || a.name || a.id)} className="text-dark-6 hover:text-red transition-colors shrink-0" title="Disconnect">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </div>

                      <SlideDown open={editingSignature === a.id}>
                        <div className="border-t border-stroke px-5 py-4 bg-surface-2">
                          <label className="text-xs font-medium text-dark-5 uppercase tracking-wider block mb-2">Email Signature</label>
                          <textarea value={signatureInput} onChange={(e) => setSignatureInput(e.target.value)} rows={4} placeholder="Your email signature (HTML supported)..." className="w-full border border-stroke rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary resize-y bg-surface" />
                          <div className="flex gap-2 mt-2">
                            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => saveSignature(a.id)} className="bg-primary hover:bg-accent text-white rounded-xl px-4 py-2 text-xs font-medium">Save Signature</motion.button>
                            <button onClick={() => setEditingSignature(null)} className="text-dark-5 text-xs hover:text-dark transition-colors">Cancel</button>
                            {signatures[a.id] && (
                              <button
                                onClick={async () => { setSignatureInput(''); const d = await api.patch('/org/account-signature', { accountId: a.id, signature: '' }); setSignatures(d || {}); setEditingSignature(null); }}
                                className="text-red text-xs hover:text-red/80 transition-colors ml-auto"
                              >
                                Remove Signature
                              </button>
                            )}
                          </div>
                        </div>
                      </SlideDown>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </StaggerItem>
        )}
        {/* Sending Limits */}
        <StaggerItem>
          <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
            <h2 className="text-base font-semibold text-dark mb-1">Sending Limits</h2>
            <p className="text-sm text-dark-5 mb-5">
              Set a daily send limit per provider (e.g. Gmail allows ~300/day). When importing a CSV with more contacts than the limit, lists are automatically split into smaller sublists.
            </p>
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <label className="text-xs font-medium text-dark-5 uppercase tracking-wider block mb-2">Daily Send Limit</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={sendLimitInput}
                  onChange={(e) => setSendLimitInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveSendLimit(); }}
                  className="w-full border border-stroke rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary bg-surface-2 transition-all duration-200"
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={saveSendLimit}
                disabled={savingLimit}
                className="bg-primary hover:bg-accent text-white rounded-xl px-5 py-2.5 text-sm font-medium disabled:opacity-50 transition-all duration-200"
              >
                {savingLimit ? 'Saving...' : 'Save'}
              </motion.button>
              {dailySendLimit && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setSendLimitInput(''); setDailySendLimit(null); api.patch('/org/send-limit', { dailySendLimit: null }); showToast('Daily send limit removed'); }}
                  className="text-red hover:text-red/80 text-sm font-medium transition-colors"
                >
                  Remove
                </motion.button>
              )}
            </div>
            {dailySendLimit && (
              <p className="text-xs text-dark-5 mt-3">
                Current limit: <span className="font-medium text-dark">{dailySendLimit} emails/day</span>. CSV imports with more contacts will be auto-split into sublists of {dailySendLimit}.
              </p>
            )}
          </div>
        </StaggerItem>
      </StaggerContainer>
    </AnimatedPage>
  );
}
