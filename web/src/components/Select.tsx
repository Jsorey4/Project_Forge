/**
 * @author Jon Sorey (UI idea ported from Preethi Seereddy's frontend, `origin/frontend-preethi`)
 * @description Shared drop-down that replaces the browser-native <select>. The trigger is a button (so
 *   <label htmlFor> still works) and the option list is a listbox drawn in a portal on <body>, positioned from
 *   the trigger and flipped upward when there is no room below, so it is never clipped by an overflow
 *   container, table row or Modal. Keyboard: Up/Down, Home/End, Enter/Space, Escape, and type-ahead (see
 *   selectModel.ts). Focus stays on the trigger; the active option is announced with aria-activedescendant.
 *   Only theme tokens are used, so light/dark and the color-blind palettes keep working.
 * @traces SE-NFR-03, SE-NFR-05, SE-NFR-07
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../shared/ui';
import { extendTypeAhead, findTypeAhead, firstEnabled, lastEnabled, stepEnabled, type SelectOption, type TypeAhead } from './selectModel';

export type { SelectOption } from './selectModel';

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface Placement {
  left: number;
  minWidth: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const GAP = 6;
const EDGE = 8;
const MAX_MENU = 288;

export function Select({ value, onChange, options, id, ariaLabel, placeholder = 'Select…', disabled, className = '' }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef<TypeAhead>({ buffer: '', at: 0 });
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);

  const openMenu = (index?: number) => {
    if (disabled) return;
    setActive(index ?? (selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : firstEnabled(options)));
    setOpen(true);
  };

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  // Position from the trigger: below by default, above when the space below is too small, never off-screen.
  const reposition = useCallback(() => {
    const t = trigger.current;
    const m = menu.current;
    if (!t || !m) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wanted = Math.min(m.scrollHeight, MAX_MENU);
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const up = below < wanted && above > below;
    const width = Math.max(m.offsetWidth, r.width);
    const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
    setPlace({
      left,
      minWidth: r.width,
      maxHeight: Math.max(96, Math.min(MAX_MENU, up ? above : below)),
      ...(up ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition, options]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    const onMove = (e: Event) => {
      if (menu.current && e.target instanceof Node && menu.current.contains(e.target)) return; // scrolling the list itself
      reposition();
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', close); // like a native select: a layout change closes the list
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, reposition]);

  // Keep the active option visible while moving with the keyboard.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, place]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key;
    if (key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // do not also close a Modal the select sits in
        close();
      }
      return;
    }
    if (key === 'Tab') {
      if (open) close();
      return;
    }
    const move = (to: number) => {
      e.preventDefault();
      if (to < 0) return;
      if (open) setActive(to);
      else openMenu(to);
    };
    if (key === 'ArrowDown') return move(stepEnabled(options, open ? active : selectedIndex, 1));
    if (key === 'ArrowUp') return move(stepEnabled(options, open ? active : selectedIndex, -1));
    if (key === 'Home') return move(firstEnabled(options));
    if (key === 'End') return move(lastEnabled(options));
    if (key === 'Enter' || key === ' ') {
      if (key === ' ' && typed.current.buffer && Date.now() - typed.current.at <= 700) {
        // A space inside a type-ahead word ("Not started") is part of the word, not a toggle.
        e.preventDefault();
        typed.current = extendTypeAhead(typed.current, ' ', Date.now());
        const hit = findTypeAhead(options, typed.current.buffer, Math.max(active, 0));
        if (hit >= 0) move(hit);
        return;
      }
      e.preventDefault();
      if (open) choose(active);
      else openMenu();
      return;
    }
    if (key.length === 1) {
      typed.current = extendTypeAhead(typed.current, key, Date.now());
      const hit = findTypeAhead(options, typed.current.buffer, open ? active : selectedIndex);
      if (hit >= 0) {
        e.preventDefault();
        if (open) setActive(hit);
        else openMenu(hit);
      }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          trigger.current?.focus(); // Safari and Firefox on macOS do not focus a button on click; keyboard use needs it
          if (open) close();
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={`input flex cursor-pointer items-center justify-between gap-2 text-left ${open ? 'border-brand ring-2 ring-brand/45' : ''} ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-muted'}`}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevron-down" className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              // Keep focus on the trigger when the pointer presses an option.
              onMouseDown={(e) => e.preventDefault()}
              className="fixed z-[70] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-pop"
              style={{
                left: place?.left ?? 0,
                top: place?.top,
                bottom: place?.bottom,
                minWidth: place?.minWidth,
                maxWidth: `calc(100vw - ${EDGE * 2}px)`,
                maxHeight: place?.maxHeight ?? MAX_MENU,
                visibility: place ? 'visible' : 'hidden',
              }}
            >
              {options.length === 0 ? <p className="px-2.5 py-2 text-sm text-muted">No options</p> : null}
              {options.map((o, i) => {
                const isSelected = i === selectedIndex;
                return (
                  <div
                    key={`${o.value}-${i}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onClick={() => choose(i)}
                    className={`flex min-h-[36px] items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm ${
                      o.disabled ? 'cursor-not-allowed text-muted opacity-60' : 'cursor-pointer'
                    } ${i === active && !o.disabled ? 'bg-surface-2' : ''} ${isSelected ? 'font-semibold text-accent-tint' : 'text-ink'}`}
                  >
                    <span className="min-w-0 break-words">{o.label}</span>
                    {isSelected ? <Icon name="check" className="h-3.5 w-3.5 text-accent" /> : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
