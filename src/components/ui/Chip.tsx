import type { ReactNode } from 'react';

interface ToggleChipProps {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Square filter chip that can be switched on and off. */
export function ToggleChip({ pressed, onToggle, children }: ToggleChipProps) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>
      {children}
    </button>
  );
}

interface TagProps {
  children: ReactNode;
}

/** Rounded label, such as a storage temperature. */
export function Tag({ children }: TagProps) {
  return <span className="tag">{children}</span>;
}

interface AllergenTagProps {
  name: string;
  code: string;
  contains: boolean;
}

/** Allergen with its GS1 code: amber when the product contains it, blue when free from it. */
export function AllergenTag({ name, code, contains }: AllergenTagProps) {
  return (
    <span className={`allergen ${contains ? 'allergen--contains' : 'allergen--free'}`}>
      {name}
      <abbr className="allergen__code" title={`GS1 allergen code ${code}`}>
        {code}
      </abbr>
    </span>
  );
}
