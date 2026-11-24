"use client";

// What a reporter can still do with a report they sent (migration 0038): answer a reviewer who asked
// for more, or withdraw a driver report. Nothing is stored on the phone: the answer and the chosen
// files live in memory, the parent drops them when the page is left, and a failed send keeps them.

import { useEffect, useId, useRef, useState } from "react";
import { answerComplaint, answerCorrection, withdrawComplaint } from "@/client/reports/api";
import { evidenceFileProblem, EVIDENCE_TYPES, uploadComplaintEvidence } from "@/client/complaints/api";
import { uploadEvidencePhoto } from "@/client/corrections/api";
import { ANSWER_MAX } from "@/domain/reports/schemas";
import { en, translated } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { Live, updateThenFocus, useFieldError } from "@/ui/report/form-a11y";

type Picked = { key: string; file: File; mediaId?: string };

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type AnswerProps = {
  kind: "complaint" | "correction";
  id: string;
  /** How many more files this report can take (0 hides the picker). */
  room: number;
  /** The answer is stored: the parent reloads the report and says so. */
  onSent: () => Promise<void>;
  /** The report moved on (409): the parent reloads it and keeps `text` for the person. */
  onChanged: (text: string) => Promise<void>;
};

export function AnswerForm({ kind, id, room, onSent, onChanged }: AnswerProps) {
  const tt = useT();
  const t = tt.reports;
  const d = tt.driverReport;
  const form = tt.forms;
  const uid = useId();
  const ids = { text: `${uid}-text`, hint: `${uid}-hint`, count: `${uid}-count`, file: `${uid}-file` };
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { error, errorProps, fail, clear, edited, field } = useFieldError();
  const list = useRef<HTMLUListElement>(null);
  const sending = useRef(false);
  // A send that finishes after the screen was left is dropped: nothing is sent from a page that is gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const complaint = kind === "complaint";
  const left = Math.max(0, room - files.length);

  const pickerOrText = () => document.getElementById(ids.file) ?? document.getElementById(ids.text);
  const pick = (chosen: FileList | null) => {
    if (!chosen || sending.current) return;
    const next = [...files];
    let message: string | null = null;
    for (const file of Array.from(chosen)) {
      const problem = complaint ? evidenceFileProblem(file, d) : PHOTO_TYPES.includes(file.type) ? null : tt.report.api.photoType;
      if (next.length >= room) message = t.answer.filesHint(room);
      else if (problem) message = problem;
      else next.push({ key: crypto.randomUUID(), file });
    }
    updateThenFocus(
      () => {
        setFiles(next);
        setNote(message);
      },
      () => document.getElementById(ids.file) ?? list.current?.querySelector("button") ?? document.getElementById(ids.text),
    );
  };
  const remove = (i: number) => {
    if (sending.current) return;
    updateThenFocus(
      () => {
        setFiles((all) => all.filter((_, n) => n !== i));
        setNote(null);
      },
      () => {
        const buttons = list.current?.querySelectorAll("button");
        return (buttons?.length ? buttons[Math.min(i, buttons.length - 1)] : null) ?? pickerOrText();
      },
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    const answer = text.trim();
    if (!answer) return fail(t.answer.empty, ids.text);
    clear();
    sending.current = true;
    setBusy(form.sending);
    const stop = (message: string) => {
      sending.current = false;
      setBusy(null);
      fail(message);
    };

    // Upload what is not uploaded yet; the ids are kept, so a retry does not upload a file twice.
    const ready: Picked[] = [];
    for (const [n, item] of files.entries()) {
      if (item.mediaId) {
        ready.push(item);
        continue;
      }
      setBusy(d.uploadingN(n + 1, files.length));
      const r = complaint ? await uploadComplaintEvidence(item.file, d.api) : await uploadEvidencePhoto(item.file);
      if (!alive.current) return;
      if (!r.ok) return stop(complaint ? translated(r.message, en.driverReport.api, d.api) : translated(r.message, en.report.api, tt.report.api));
      const done = { ...item, mediaId: r.mediaId };
      ready.push(done);
      setFiles((all) => all.map((f) => (f.key === item.key ? done : f)));
    }

    setBusy(form.sending);
    const result = complaint
      ? await answerComplaint(id, { text: answer, evidence: ready.map((f) => ({ mediaId: f.mediaId!, captureKind: "file_upload" as const })) })
      : await answerCorrection(id, { text: answer, mediaIds: ready.map((f) => f.mediaId!) });
    if (!alive.current) return;
    if (result.ok) return void (await onSent());
    if (result.reason === "changed") {
      await onChanged(answer);
      // Still here: the reviewer asked again, so the answer can be edited and sent.
      sending.current = false;
      if (alive.current) setBusy(null);
      return;
    }
    stop(translated(result.message, en.reports.api, t.api));
  };

  return (
    <form className="pn-reports__answer" onSubmit={onSubmit} noValidate aria-labelledby={`${uid}-title`} data-testid="answer-form">
      <h3 id={`${uid}-title`}>{t.answer.title}</h3>
      <p className="pn-reports__intro">{complaint ? t.answer.complaintIntro : t.answer.correctionIntro}</p>
      <div className="pn-report__field">
        <label htmlFor={ids.text} className="pn-report__label">
          {t.answer.label}
        </label>
        <p id={ids.hint} className="pn-report__hint">
          {t.answer.hint(ANSWER_MAX)}
        </p>
        <textarea
          {...field(ids.text, `${ids.hint} ${ids.count}`)}
          className="pn-report__input pn-report__textarea"
          rows={5}
          maxLength={ANSWER_MAX}
          required
          readOnly={busy !== null}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            edited(ids.text);
          }}
          data-testid="answer-text"
        />
        <span id={ids.count} className="pn-report__count">
          {form.count(text.trim().length, ANSWER_MAX)}
        </span>
      </div>

      {room > 0 ? (
        <div className="pn-report__field">
          <span className="pn-report__label">{complaint ? t.answer.filesLabel : t.answer.photosLabel}</span>
          {files.length > 0 ? (
            <ul ref={list} tabIndex={-1} aria-label={t.answer.chosenFiles} className="pn-report__photos" data-testid="answer-files">
              {files.map((f, i) => (
                <li key={f.key}>
                  <span className="pn-report__photo-name">{f.file.name.slice(0, 60)}</span>
                  <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => remove(i)} aria-label={t.answer.removeFile(f.file.name.slice(0, 60))}>
                    {form.remove}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {left > 0 ? (
            <>
              <input
                id={ids.file}
                type="file"
                multiple
                accept={complaint ? EVIDENCE_TYPES.join(",") : PHOTO_TYPES.join(",")}
                className="pn-report__file"
                aria-describedby={`${ids.file}-hint`}
                onClick={(e) => {
                  if (sending.current) e.preventDefault(); // no second picker while files upload
                }}
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
                data-testid="answer-file-input"
              />
              <label htmlFor={ids.file} className="pn-btn pn-btn--secondary pn-report__small" aria-disabled={busy !== null || undefined}>
                {complaint ? t.answer.chooseFiles : t.answer.choosePhotos}
              </label>
              <p id={`${ids.file}-hint`} className="pn-report__hint">
                {t.answer.filesHint(left)}
              </p>
            </>
          ) : null}
          <Live className="pn-report__hint">{note}</Live>
        </div>
      ) : null}

      {error ? (
        <p {...errorProps} className="pn-report__error" data-testid="answer-error">
          {error}
        </p>
      ) : null}
      <Live className="sr-only">{busy}</Live>
      <button type="submit" className="pn-btn pn-btn--primary pn-report__action" aria-disabled={busy !== null || undefined} data-testid="answer-send">
        {busy ?? t.answer.send}
      </button>
    </form>
  );
}

type WithdrawProps = {
  id: string;
  onDone: () => Promise<void>;
  onChanged: () => Promise<void>;
};

/** "Withdraw this report" with a native <dialog> to confirm: the report is deleted after 30 days. */
export function WithdrawButton({ id, onDone, onChanged }: WithdrawProps) {
  const tt = useT();
  const t = tt.reports;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  const confirm = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const r = await withdrawComplaint(id);
    working.current = false;
    setBusy(false);
    setOpen(false);
    if (r.ok) return onDone();
    if (r.reason === "changed") return onChanged();
    setError(translated(r.message, en.reports.api, t.api));
  };

  return (
    <>
      <button
        type="button"
        className="pn-btn pn-btn--secondary pn-report__action"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid="withdraw-open"
      >
        {t.withdraw.button}
      </button>
      {error ? (
        <p role="alert" className="pn-report__error" data-testid="withdraw-error">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title={t.withdraw.title}
        confirmLabel={busy ? t.withdraw.busy : t.withdraw.confirm}
        tone="danger"
        onConfirm={() => void confirm()}
        onCancel={() => {
          if (!working.current) setOpen(false);
        }}
        testId="withdraw-dialog"
      >
        <p>{t.withdraw.body}</p>
      </ConfirmDialog>
    </>
  );
}
