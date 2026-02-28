'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
};

export default function LoginPage() {
  const { login, token, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && token) {
      window.location.href = '/';
    }
  }, [ready, token]);

  if (!ready || token) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post('/auth/login', { email, password });
      if (data.token) {
        login(data.token, data.refreshToken);
      } else {
        setError('No token received');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

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
        initial="hidden"
        animate="visible"
        variants={stagger}
        className="w-full max-w-[400px] relative z-10"
      >
        <motion.div variants={fadeUp} className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-dark tracking-tight">
            Hack<span className="text-primary">-Nation</span>
          </h1>
          <p className="text-dark-5 text-sm mt-2">Sign in to your account</p>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="rounded-2xl bg-surface border border-stroke p-8 shadow-card-2"
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <motion.div variants={fadeUp}>
              <label className="block text-[13px] font-medium text-dark mb-2">Email</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-stroke bg-surface rounded-xl px-4 py-3 text-sm text-dark outline-none transition-all duration-150 focus:border-primary placeholder:text-dark-6"
              />
            </motion.div>

            <motion.div variants={fadeUp}>
              <label className="block text-[13px] font-medium text-dark mb-2">Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border border-stroke bg-surface rounded-xl px-4 py-3 text-sm text-dark outline-none transition-all duration-150 focus:border-primary placeholder:text-dark-6"
              />
            </motion.div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-red text-sm bg-red-light-6 rounded-xl px-4 py-3"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {error}
              </motion.div>
            )}

            <motion.div variants={fadeUp} className="pt-1">
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={loading ? {} : { scale: 1.01 }}
                whileTap={loading ? {} : { scale: 0.99 }}
                className="w-full bg-primary hover:bg-accent text-white rounded-xl px-6 py-3.5 text-sm font-semibold disabled:opacity-50 transition-colors duration-150 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-[spin_0.8s_linear_infinite]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </motion.button>
            </motion.div>
          </form>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-6 text-center">
          <a
            href="https://projects.hack-nation.ai/#/auth"
            className="text-[13px] text-dark-6 hover:text-primary transition-colors"
          >
            Forgot password?
          </a>
        </motion.div>
      </motion.div>
    </div>
  );
}
