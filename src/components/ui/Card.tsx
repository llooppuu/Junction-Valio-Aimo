import { useId, type ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  icon: ReactNode;
}

/** Key figure with a label, a big value and a short note. */
export function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__head">
        <p className="stat-card__label">{label}</p>
        <span className="stat-card__icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="stat-card__value">{value}</p>
      <p className="stat-card__sub">{sub}</p>
    </div>
  );
}

export type PanelAccent = 'primary' | 'accent' | 'none';

interface PanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Link or button shown at the top right. */
  action?: ReactNode;
  /** Icon shown at the top right when there is no action. */
  icon?: ReactNode;
  /** Icon shown before the title. */
  titleIcon?: ReactNode;
  accent?: PanelAccent;
  className?: string;
  headingLevel?: 'h2' | 'h3';
  children?: ReactNode;
}

/** White content panel with an optional coloured top border. */
export function Panel({
  title,
  subtitle,
  action,
  icon,
  titleIcon,
  accent = 'primary',
  className,
  headingLevel = 'h2',
  children,
}: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel;
  return (
    <section
      className={['panel', `panel--${accent}`, className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <div className="panel__head">
        <div className="panel__titles">
          <Heading id={headingId} className="panel__title">
            {titleIcon && (
              <span className="panel__title-icon" aria-hidden="true">
                {titleIcon}
              </span>
            )}
            {title}
          </Heading>
          {subtitle && <p className="panel__subtitle">{subtitle}</p>}
        </div>
        {action && <div className="panel__action">{action}</div>}
        {!action && icon && (
          <span className="panel__icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      {children !== undefined && <div className="panel__body">{children}</div>}
    </section>
  );
}

interface EmptyStateProps {
  title: string;
  children?: ReactNode;
}

/** Dashed box for lists with nothing in them yet. */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children && <p className="empty-state__text">{children}</p>}
    </div>
  );
}
