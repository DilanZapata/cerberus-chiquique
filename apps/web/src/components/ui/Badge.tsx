import clsx from 'clsx';

type BadgeTone = 'good' | 'warning' | 'critical' | 'neutral' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  critical: 'bg-red-50 text-red-800 ring-red-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  info: 'bg-blue-50 text-blue-800 ring-blue-600/20',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: BadgeTone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}
