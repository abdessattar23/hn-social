'use client';
import { useState, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Toast = {
  id: number;
  message: string;
  type?: 'success' | 'error' | 'info';
  action?: { label: string; href: string };
};

const ToastContext = createContext<{
  showToast: (message: string, action?: { label: string; href: string }) => void;
}>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

const accentColor = {
  success: 'bg-green',
  error: 'bg-red',
  info: 'bg-primary',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, action?: { label: string; href: string }) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type: 'info', action }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5 items-end">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring' as const, stiffness: 350, damping: 28 }}
              className="bg-surface rounded-xl shadow-card-2 border border-stroke flex items-stretch max-w-sm overflow-hidden"
            >
              <div className={`w-1 shrink-0 ${accentColor[t.type || 'info']}`} />
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-sm text-dark">{t.message}</span>
                {t.action && (
                  <a
                    href={t.action.href}
                    className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                  >
                    {t.action.label}
                  </a>
                )}
                <button onClick={() => dismiss(t.id)} className="text-dark-6 hover:text-dark transition-colors ml-1 shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
