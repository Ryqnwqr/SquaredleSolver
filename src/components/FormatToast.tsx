import { useEffect } from "react";

interface FormatToastProps {
  visible: boolean;
  onDismiss: () => void;
}

export function FormatToast({ visible, onDismiss }: FormatToastProps) {
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(id);
  }, [visible, onDismiss]);

  return (
    <div
      className={`format-toast ${visible ? "format-toast--visible" : ""}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="format-toast__inner">
        <span className="format-toast__icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M8 16l3-4 2 2.5 3-4.5" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="8" y1="8" x2="8.01" y2="8" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
        <div className="format-toast__text">
          <strong>Wrong format</strong>
          <span>Paste a puzzle screenshot image, not text.</span>
        </div>
        <button
          type="button"
          className="format-toast__close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
