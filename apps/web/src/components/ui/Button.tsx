'use client';

import { ButtonHTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-black',
  secondary: 'border border-line-axis text-ink hover:bg-surface-page',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50',
  ghost: 'text-ink-secondary hover:bg-surface-page',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: Variant;
}

export function Button({ variant = 'primary', className, children, disabled, ...props }: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
