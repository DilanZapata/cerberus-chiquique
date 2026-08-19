'use client';

import { HTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover = false, children, ...props }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      whileHover={hover ? { y: -2, boxShadow: '0 8px 30px rgba(11,11,11,0.10)' } : undefined}
      className={clsx('rounded-xl border border-line-hair bg-surface-card shadow-card', className)}
      {...(props as any)}
    >
      {children}
    </motion.div>
  );
}
