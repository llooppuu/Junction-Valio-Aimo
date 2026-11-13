import type { ReactNode } from 'react';

interface PageHeroProps {
  title: string;
  lead: ReactNode;
  eyebrow?: string;
  /** "primary" is the dark petrol band on the dashboard; "soft" is the lavender band elsewhere. */
  variant?: 'primary' | 'soft';
  actions?: ReactNode;
}

export default function PageHero({ title, lead, eyebrow, variant = 'soft', actions }: PageHeroProps) {
  return (
    <div className={`page-hero page-hero--${variant}`}>
      <div className="container page-hero__inner">
        <div className="page-hero__text">
          {eyebrow && <p className="page-hero__eyebrow">{eyebrow}</p>}
          <h1 className="page-hero__title">{title}</h1>
          <p className="page-hero__lead">{lead}</p>
        </div>
        {actions && <div className="page-hero__actions">{actions}</div>}
      </div>
    </div>
  );
}
