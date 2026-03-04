'use client';
import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import Nav from '@/components/nav';
import { ToastProvider } from '@/components/toast';
import { AnimatePresence, motion } from 'framer-motion';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AuthProvider>
      <ToastProvider>
        <div className="min-h-screen bg-gray-1">
          <Nav />
          <AnimatePresence mode="wait">
            <motion.main
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const }}
              className="max-w-6xl mx-auto px-5 pt-10 pb-16"
            >
              {children}
            </motion.main>
          </AnimatePresence>
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
