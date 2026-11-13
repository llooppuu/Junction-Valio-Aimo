interface MeterProps {
  /** Share between 0 and 1. */
  value: number;
  label: string;
  tone?: 'primary' | 'warning';
  className?: string;
}

/** Thin horizontal bar showing a share, such as delivery reliability. */
export default function Meter({ value, label, tone = 'primary', className }: MeterProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={['meter', `meter--${tone}`, className ?? ''].filter(Boolean).join(' ')}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
    >
      <span className="meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
