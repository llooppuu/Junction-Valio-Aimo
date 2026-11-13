import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'accent' | 'primary' | 'outline' | 'outline-light' | 'danger';
export type ButtonSize = 'md' | 'sm';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return ['btn', `btn--${variant}`, size === 'sm' ? 'btn--sm' : '', extra ?? ''].filter(Boolean).join(' ');
}

/** Button, or a link styled as one when `href` is given. */
export default function Button(props: ButtonProps | LinkProps) {
  const { variant = 'primary', size = 'md', icon, children, className, ...rest } = props;
  const content = (
    <>
      {icon}
      <span>{children}</span>
    </>
  );

  if (rest.href !== undefined) {
    return (
      <a className={classes(variant, size, className)} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={classes(variant, size, className)}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  );
}
