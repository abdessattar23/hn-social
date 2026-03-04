'use client';
import { motion } from 'framer-motion';

const steps = ['Basics', 'Content', 'Review & Send'];

export default function StepIndicator({ currentStep }: { currentStep: number }) {
  const progress = ((currentStep - 1) / (steps.length - 1)) * 100;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        {steps.map((label, i) => {
          const step = i + 1;
          const completed = step < currentStep;
          const active = step === currentStep;
          return (
            <button
              key={label}
              className={`relative px-4 py-2 text-[13px] font-medium rounded-lg transition-colors duration-300 ${
                active
                  ? 'text-primary'
                  : completed
                  ? 'text-dark'
                  : 'text-dark-6'
              }`}
            >
              <span className="relative z-10 flex items-center gap-2">
                {completed && (
                  <motion.svg
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring' as const, stiffness: 400, damping: 15 }}
                    className="w-3.5 h-3.5 text-green"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </motion.svg>
                )}
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-1 bg-stroke rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }}
        />
      </div>
    </div>
  );
}
