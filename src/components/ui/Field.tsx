import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface LabelProps {
  label: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
}

function labelClass(hideLabel?: boolean): string {
  return hideLabel ? 'visually-hidden' : 'field__label';
}

type TextInputProps = LabelProps & InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ label, hideLabel, className, ...rest }: TextInputProps) {
  const id = useId();
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={labelClass(hideLabel)}>
        {label}
      </label>
      <input id={id} className="input" {...rest} />
    </div>
  );
}

type SelectProps = LabelProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: { value: string; label: string }[];
    /** Label beside the control instead of above it. */
    inline?: boolean;
  };

export function Select({ label, hideLabel, inline, options, className, ...rest }: SelectProps) {
  const id = useId();
  return (
    <div className={['field', inline ? 'field--inline' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={labelClass(hideLabel)}>
        {label}
      </label>
      <select id={id} className="input select" {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type CheckboxProps = { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={['checkbox', className ?? ''].filter(Boolean).join(' ')}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

type TextAreaProps = LabelProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ label, hideLabel, className, ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={labelClass(hideLabel)}>
        {label}
      </label>
      <textarea id={id} className="input textarea" {...rest} />
    </div>
  );
}
