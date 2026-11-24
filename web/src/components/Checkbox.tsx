/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`)
 * @description Shared checkbox. A real, visually hidden <input type="checkbox"> keeps native semantics, keyboard
 *   and label behaviour; the visible 20px box (6px corners, accent fill with a check when on, accent border on
 *   hover) is drawn beside it. Colors are theme tokens only, so every theme and color-blind palette works.
 * @traces SE-NFR-03, SE-NFR-05, SE-FR-15
 */
import type { ReactNode } from 'react';
import { Icon } from '../shared/ui';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Required when there is no visible label, so the control still has an accessible name. */
  ariaLabel?: string;
  className?: string;
  id?: string;
}

export function Checkbox({ checked, onChange, label, description, disabled, ariaLabel, className = '', id }: CheckboxProps) {
  return (
    <label className={`group inline-flex items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-brand-ink transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ${
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-field'
        } ${disabled ? '' : 'group-hover:border-accent'} ${label || description ? 'mt-px' : ''}`}
      >
        {checked ? <Icon name="check" className="h-3.5 w-3.5 stroke-[3]" /> : null}
      </span>
      {label || description ? (
        <span className="min-w-0 text-sm">
          {label ? <span className="text-ink">{label}</span> : null}
          {description ? <span className="block text-xs text-muted">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
