'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/invite/${code}`)
      .then((r) => {
        if (!r.ok) throw new Error('Invalid invite');
        return r.json();
      })
      .then((d) => setOrgName(d.name))
      .catch(() => setError('This invite link is invalid or has expired.'));
  }, [code]);

  return (
    <div className="min-h-[85vh] flex items-center justify-center -mt-10 relative">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #1C1917 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-[400px] relative z-10"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-dark tracking-tight">
            Hack<span className="text-primary">-Nation</span>
          </h1>
        </div>

        <div className="rounded-2xl bg-surface border border-stroke p-8 shadow-card-2 text-center">
          {error ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-light-6 flex items-center justify-center">
                <svg className="w-5 h-5 text-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-dark-5 text-sm">{error}</p>
            </motion.div>
          ) : orgName ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
              <p className="text-dark-5 text-sm mb-2">You&apos;ve been invited to join</p>
              <p className="text-xl font-bold text-dark mb-6">{orgName}</p>
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => router.push(`/login?inviteCode=${code}`)}
                className="w-full bg-primary hover:bg-accent text-white rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors duration-150"
              >
                Join & Register
              </motion.button>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-[spin_0.8s_linear_infinite]" />
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
