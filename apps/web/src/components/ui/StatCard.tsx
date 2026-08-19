'use client';

import { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Card } from './Card';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: 'default' | 'warning' | 'critical' | 'good';
  hint?: string;
}

const TONE_ICON_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-brand-50 text-brand-600',
  warning: 'bg-amber-50 text-amber-600',
  critical: 'bg-red-50 text-red-600',
  good: 'bg-emerald-50 text-emerald-600',
};

export function StatCard({ label, value, icon: Icon, tone = 'default', hint }: StatCardProps) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', TONE_ICON_CLASSES[tone])}>
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-ink-secondary">{label}</div>
        <motion.div
          key={String(value)}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          className="text-2xl font-semibold text-ink"
        >
          {value}
        </motion.div>
        {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
      </div>
    </Card>
  );
}
