"use client";

// "Save place" / "Rename place" dialog: one plain-text name of 1–40 characters, prefilled with the
// place's label (or "Pinned location"). Native <dialog> opened with showModal() like ConfirmDialog
// (focus trapped, Escape cancels, focus returns to the opener). The place stays on this phone.

import "@/ui/kit/styles";
import "./saved.css";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PLACE_LABEL_MAX, cleanPlaceLabel } from "@/domain/saved/saved";

type Props = {
  open: boolean;
  title: string;
  initialLabel: string;
  confirmLabel?: string;
  /** Resolves when stored; a rejection shows "Couldn't save on this phone." and keeps the dialog. */
  onSave: (label: string) => Promise<void>;
  onCancel: () => void;
  testId?: string;
};

export function SavePlaceDialog({ open, title, initialLabel, confirmLabel = "Save", onSave, onCancel, testId }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const id = useId();
  const [value, setValue] = useState(initialLabel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A new opening starts from the label it was opened with (adjusted during render).
  const [openedWith, setOpenedWith] = useState<{ open: boolean; label: string }>({ open, label: initialLabel });
  if (openedWith.open !== open || (open && openedWith.label !== initialLabel)) {
    setOpenedWith({ open, label: initialLabel });
    if (open) {
      setValue(initialLabel.slice(0, PLACE_LABEL_MAX));
      setError(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      returnFocus.current = document.activeElement;
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      input.current?.focus();
      input.current?.select();
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    }
  }, [open]);

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleaned = cleanPlaceLabel(value);
    if (!cleaned.ok) {
      setError(cleaned.message);
      input.current?.focus();
      return;
    }
    setBusy(true);
    onSave(cleaned.label).then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setError("Couldn't save on this phone. Try again.");
      },
    );
  };

  return (
    <dialog
      ref={dialog}
      className="pn-dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      data-testid={testId}
    >
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className="pn-dialog__title">
          {title}
        </h2>
        <label htmlFor={`${id}-name`} className="pn-saved-dialog__label">
          Name
        </label>
        <input
          ref={input}
          id={`${id}-name`}
          className="pn-saved-dialog__input"
          type="text"
          value={value}
          maxLength={PLACE_LABEL_MAX}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
        />
        <p id={`${id}-hint`} className="pn-saved-dialog__hint">
          Up to {PLACE_LABEL_MAX} characters. Kept on this phone only.
        </p>
        {error ? (
          <p id={`${id}-error`} className="pn-saved-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pn-dialog__actions">
          <button type="submit" className="pn-btn pn-btn--primary" aria-disabled={busy ? true : undefined}>
            {confirmLabel}
          </button>
          <button type="button" className="pn-btn pn-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
