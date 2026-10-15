"use client";

// Confirmation dialog on the native <dialog> element opened with showModal(): the browser makes
// the rest of the page inert (the focus trap) and puts it in the top layer. Focus starts on the
// safe choice (Cancel) and returns to whatever had it when the dialog closes. Escape cancels; the
// key is consumed here so the panel underneath does not also go back (useEscapeToClose ignores a
// handled Escape).

import "./styles";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for destructive confirmations (Delete, Clear history). */
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
};

export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Cancel", tone = "default", onConfirm, onCancel, testId }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const id = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      returnFocus.current = document.activeElement;
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      cancel.current?.focus();
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    }
  }, [open]);

  // Hidden by Activity (navigation away) or unmounted while open: close, so no modal is left over.
  useEffect(() => {
    const el = dialog.current;
    return () => {
      if (el?.open && typeof el.close === "function") el.close();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) onCancel();
  };

  return (
    <dialog
      ref={dialog}
      className="pn-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={children ? `${id}-body` : undefined}
      onKeyDown={onKeyDown}
      // The browser's own cancel (Escape on some platforms, or a close request): keep React in charge.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      data-testid={testId}
    >
      <h2 id={`${id}-title`} className="pn-dialog__title">
        {title}
      </h2>
      {children ? (
        <div id={`${id}-body`} className="pn-dialog__body">
          {children}
        </div>
      ) : null}
      <div className="pn-dialog__actions">
        <button type="button" className={tone === "danger" ? "pn-btn pn-btn--danger" : "pn-btn pn-btn--primary"} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button ref={cancel} type="button" className="pn-btn pn-btn--secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
