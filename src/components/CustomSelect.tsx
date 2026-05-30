"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type CustomSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

interface CustomSelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly CustomSelectOption<T>[];
  disabled?: boolean;
  variant?: "field" | "pill";
  id?: string;
  "aria-label"?: string;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`custom-select__chevron${open ? " custom-select__chevron--open" : ""}`}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  variant = "field",
  id: idProp,
  "aria-label": ariaLabel,
}: CustomSelectProps<T>) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listboxId = `${id}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value)
    )
  );

  const selected = options.find((o) => o.value === value) ?? options[0];

  const close = useCallback(() => setOpen(false), []);

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      onChange(option.value);
      close();
    },
    [close, onChange, options]
  );

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) setActiveIndex(idx);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => (i + delta + options.length) % options.length);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (open) selectIndex(activeIndex);
        else setOpen(true);
        break;
      }
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={`custom-select custom-select--${variant}${open ? " custom-select--open" : ""}${disabled ? " custom-select--disabled" : ""}`}
    >
      <button
        type="button"
        id={id}
        className="custom-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="custom-select__value">{selected?.label}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <ul
          id={listboxId}
          className="custom-select__menu"
          role="listbox"
          aria-labelledby={id}
          aria-activedescendant={`${id}-option-${activeIndex}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    "custom-select__option",
                    isSelected && "custom-select__option--selected",
                    isActive && "custom-select__option--active",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectIndex(index)}
                >
                  {option.label}
                  {isSelected && (
                    <span className="custom-select__check" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
