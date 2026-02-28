'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useToast } from '@/components/toast';
import { AnimatedPage, StaggerContainer, StaggerItem, SlideDown } from '@/components/motion';
import { motion } from 'framer-motion';

type Account = { id: string; type: string; name?: string; status?: string };

const WHATSAPP_TYPES = ['WHATSAPP'];
const LINKEDIN_TYPES = ['LINKEDIN', 'LINKEDIN_OAUTH'];

export default function SettingsPage() {
  const { authed } = useRequireAuth();
  const { showToast } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [editingSignature, setEditingSignature] = useState<string | null>(null);
  const [signatureInput, setSignatureInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authed) return;
    loadAccounts(); loadAliases(); loadSignatures();
  }, [authed]);

  const loadAccounts = async () => { try { const d = await api.get('/unipile/accounts'); setAccounts(d.items || d || []); } catch {} };
  const loadAliases = async () => { try { const d = await api.get('/org/account-aliases'); setAliases(d || {}); } catch {} };
  const saveAlias = async (accountId: string) => { try { const d = await api.patch('/org/account-alias', { accountId, alias: aliasInput.trim() }); setAliases(d || {}); setEditingAlias(null); } catch {} };
  const loadSignatures = async () => { try { const d = await api.get('/org/account-signatures'); setSignatures(d || {}); } catch {} };
  const saveSignature = async (accountId: string) => { try { const d = await api.patch('/org/account-signature', { accountId, signature: signatureInput }); setSignatures(d || {}); setEditingSignature(null); } catch {} };
  const disconnectAccount = async (accountId: string, name: string) => { if (!confirm(`Disconnect "${name}"?`)) return; try { await api.del(`/unipile/accounts/${accountId}`); loadAccounts(); } catch (e: any) { alert(e.message); } };

  const hasWhatsApp = accounts.some((a) => WHATSAPP_TYPES.includes(a.type));
  const hasLinkedIn = accounts.some((a) => LINKEDIN_TYPES.includes(a.type));

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

      <StaggerContainer className="max-w-2xl space-y-6" staggerDelay={0.08}>
        {/* Connect Accounts */}
        <StaggerItem>
          <div className="rounded-2xl bg-surface p-6 shadow-1 border border-stroke/60">
            <h2 className="text-base font-semibold text-dark mb-1">Accounts</h2>
            <p className="text-sm text-dark-5 mb-5">Connect one WhatsApp and one LinkedIn account to start sending.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`border rounded-2xl p-5 transition-all duration-200 ${hasWhatsApp ? 'border-green/30 bg-green/[0.03]' : 'border-stroke'}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasWhatsApp ? 'bg-green/10' : 'bg-surface-2'}`}>
                    <svg className={`w-4 h-4 ${hasWhatsApp ? 'text-green' : 'text-dark-5'}`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 0 0 .611.611l4.458-1.495A11.96 11.96 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.592-.826-6.328-2.207l-.14-.114-3.292 1.103 1.103-3.293-.114-.14A9.935 9.935 0 0 1 2 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/>
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
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                    hasWhatsApp
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
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
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
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                    hasLinkedIn
                      ? 'bg-linkedin/10 text-linkedin cursor-default'
                      : 'bg-linkedin text-white hover:opacity-90 disabled:opacity-50'
                  }`}
                >
                  {hasLinkedIn ? 'Connected' : 'Connect LinkedIn'}
                </motion.button>
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
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${
                          WHATSAPP_TYPES.includes(a.type) ? 'bg-green-light-7 text-green'
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
      </StaggerContainer>
    </AnimatedPage>
  );
}
