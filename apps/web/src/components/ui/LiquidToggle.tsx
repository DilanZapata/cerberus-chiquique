'use client';

import { motion } from 'framer-motion';
import clsx from 'clsx';

interface LiquidToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Interruptor estilo "liquid glass" (vidrio esmerilado translucido, al estilo Apple). */
export function LiquidToggle({ checked, onChange, disabled, label }: LiquidToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-9 w-16 shrink-0 overflow-hidden rounded-full border transition-colors duration-300 ease-out',
        'backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-white/40 bg-brand-500/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_-6px_10px_rgba(0,0,0,0.12),0_2px_10px_rgba(63,127,245,0.35)]'
          : 'border-line-axis/60 bg-white/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),inset_0_-4px_8px_rgba(0,0,0,0.05)]',
      )}
    >
      {/* brillo superior tipo vidrio */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/50 to-transparent"
      />
      <motion.span
        aria-hidden
        className={clsx(
          'absolute top-1 h-7 w-7 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.9)]',
          checked ? 'bg-white' : 'bg-white/90',
        )}
        animate={{ left: checked ? 32 : 4 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}
