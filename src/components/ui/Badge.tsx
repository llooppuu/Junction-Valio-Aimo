import type { ReactNode } from 'react';

export type BadgeTone = 'warning' | 'info' | 'soft' | 'drift' | 'ok' | 'best' | 'better' | 'good' | 'danger';

interface BadgeProps {
  tone: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Small pill for statuses, risk levels and rankings. */
export default function Badge({ tone, icon, children, className }: BadgeProps) {
  return (
    <span className={['badge', `badge--${tone}`, className ?? ''].filter(Boolean).join(' ')}>
      {icon}
      {children}
    </span>
  );
}
