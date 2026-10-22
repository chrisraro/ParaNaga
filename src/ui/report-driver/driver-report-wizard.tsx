"use client";

// Report a driver, privately (S18, F-D4, task B8): 1 Before you start -> 2 Photo or video ->
// 3 What happened -> 4 Review and send -> receipt with a PN-XXXX-XX reference.
// A report is never published and never sent to Naga City by ParaNaga. Sending needs an account;
// guests read the explainer and are asked to sign in. Nothing is stored on the phone: answers and
// captured files live in memory and are dropped when the screen closes.
//
// Focus moves to the step heading on every step change. Escape and Back step out one step (the
// page's own Escape-to-close runs only on step 1). The camera exists only on step 2: its tracks
// are stopped when the step changes or the screen unmounts.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "./driver-report.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { EVIDENCE_TYPES, evidenceType, submitComplaint, uploadComplaintEvidence } from "@/client/complaints/api";
import { useGeolocation } from "@/client/geo/use-geolocation";
import { complaintCategoryInfo, complaintCategoryLabel, type ComplaintCategory } from "@/domain/complaints/categories";
import {
  COMPLAINT_DESCRIPTION_MAX,
  complaintGpsSchema,
  incidentTimeProblem,
  LOCATION_TEXT_MAX,
  MAX_COMPLAINT_EVIDENCE,
  OPERATOR_MAX,
  validateCategory,
  validateComplaintDescription,
  validateVehicleId,
  VEHICLE_ID_MAX,
  type CaptureKind,
  type ComplaintGps,
  type ComplaintReceipt,
} from "@/domain/complaints/schemas";
import { complaintStatusLabel } from "@/domain/complaints/status";
import { en, translated } from "@/i18n/dict";
import { DEFAULT_LOCALE, formatLocale, type Locale } from "@/i18n/locales";
import { useLocale, useT } from "@/i18n/provider";
import { CameraCapture } from "./camera-capture";

type Step = 1 | 2 | 3 | 4;
export type Evidence = {
  key: string;
  blob: Blob;
  url: string;
  kind: "photo" | "video";
  captureKind: CaptureKind;
  capturedAt: string;
  mediaId?: string;
};

const STEP_KEYS = { 1: "start", 2: "media", 3: "what", 4: "review" } as const;
const STEPS = 4;

/** "YYYY-MM-DDTHH:mm" in the phone's local time, for <input type="datetime-local">. */
function localNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function localToIso(local: string): string | null {
  const t = new Date(local).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function formatLocal(local: string, locale: Locale = DEFAULT_LOCALE): string {
  const t = new Date(local);
  return Number.isFinite(t.getTime()) ? t.toLocaleString(formatLocale(locale), { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function DriverReportWizard() {
  const tt = useT();
  const t = tt.driverReport;
  const form = tt.forms;
  const locale = useLocale();
  const uid = useId();
  const { user, loading } = useAuthSession();

  const [step, setStep] = useState<Step>(1);
  const [items, setItems] = useState<Evidence[]>([]);
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [description, setDescription] = useState("");
  const [incidentLocal, setIncidentLocal] = useState("");
  const [gps, setGps] = useState<ComplaintGps | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locationText, setLocationText] = useState("");
  const [operator, setOperator] = useState("");
  const [plate, setPlate] = useState("");
  const [bodyNumber, setBodyNumber] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ComplaintReceipt | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);

  // Object URLs of captured files are released when the screen closes.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  // Location: asked only on tap; one fix is kept, then the watch stops (battery, privacy).
  const wantFix = useRef(false);
  const stopGeo = useRef<() => void>(() => undefined);
  const geo = useGeolocation({
    onFix: (fix) => {
      if (!wantFix.current) return;
      wantFix.current = false;
      const parsed = complaintGpsSchema.safeParse({ lat: fix.lat, lng: fix.lng, accuracyM: Math.round(fix.accuracy) });
      if (parsed.success) {
        setGps(parsed.data);
        setLocationNote(null);
      } else {
        setLocationNote(t.outsideNaga);
      }
      setLocating(false);
      stopGeo.current();
    },
  });
  useEffect(() => {
    stopGeo.current = geo.stop;
  });
  const geoFailed = ["denied", "unavailable", "timeout", "unsupported", "insecure"].includes(geo.state);
  const findingLocation = locating && !geoFailed;
  const shownLocationNote =
    locationNote ??
    (locating && geo.state === "denied"
      ? t.locationOff
      : locating && geoFailed
        ? t.locationFailed
        : null);

  // Focus the step heading on every step change (not on first render: the page title has focus).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, receipt]);

  const go = (next: Step) => {
    setError(null);
    if (next === 3 && !incidentLocal) setIncidentLocal(localNow());
    if (next !== 3 && locating) {
      wantFix.current = false;
      setLocating(false);
      stopGeo.current();
    }
    setStep(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || receipt || step === 1 || sending) return;
    e.preventDefault(); // handled here: the page's Escape-to-close must not also run
    go((step - 1) as Step);
  };

  const addItem = (blob: Blob, captureKind: CaptureKind): string | null => {
    if (itemsRef.current.length >= MAX_COMPLAINT_EVIDENCE) return t.tooMany(MAX_COMPLAINT_EVIDENCE);
    const mime = evidenceType(blob.type);
    if (!mime) return t.api.badType;
    const item: Evidence = {
      key: crypto.randomUUID(),
      blob,
      url: URL.createObjectURL(blob),
      kind: mime.startsWith("video/") ? "video" : "photo",
      captureKind,
      capturedAt: new Date().toISOString(),
    };
    setItems((all) => [...all, item]);
    return null;
  };
  const removeItem = (key: string) => {
    setItems((all) => {
      const gone = all.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return all.filter((i) => i.key !== key);
    });
  };

  const onNext3 = () => {
    const problem =
      validateCategory(category, tt) ??
      validateComplaintDescription(description, tt) ??
      incidentTimeProblem(localToIso(incidentLocal) ?? "", Date.now(), t) ??
      validateVehicleId(plate, t.plateName, t) ??
      validateVehicleId(bodyNumber, t.bodyName, t);
    if (problem) return setError(problem);
    go(4);
  };

  const onSend = async () => {
    if (!user || !category) return;
    if (!accepted) return setError(t.tickBox);
    const incidentAt = localToIso(incidentLocal);
    if (!incidentAt) return go(3);
    setError(null);

    // Upload what is not uploaded yet; uploaded ids are kept, so a retry does not upload twice.
    const uploaded: Evidence[] = [];
    for (const [n, item] of items.entries()) {
      if (item.mediaId) {
        uploaded.push(item);
        continue;
      }
      setSending(t.uploadingN(n + 1, items.length));
      const result = await uploadComplaintEvidence(item.blob, t.api);
      if (!result.ok) {
        setSending(null);
        return setError(translated(result.message, en.driverReport.api, t.api));
      }
      const done = { ...item, mediaId: result.mediaId };
      uploaded.push(done);
      setItems((all) => all.map((i) => (i.key === item.key ? done : i)));
    }

    setSending(form.sending);
    const result = await submitComplaint({
      clientRequestId: requestId,
      category,
      description: description.trim(),
      incidentAt,
      ...(gps ? { gps } : {}),
      ...(locationText.trim() ? { locationText: locationText.trim() } : {}),
      ...(operator.trim() ? { operator: operator.trim() } : {}),
      ...(plate.trim() ? { plate: plate.trim() } : {}),
      ...(bodyNumber.trim() ? { bodyNumber: bodyNumber.trim() } : {}),
      evidence: uploaded.map((i) => ({ mediaId: i.mediaId!, captureKind: i.captureKind, capturedAt: i.capturedAt })),
      noticeAccepted: true,
    });
    setSending(null);
    if (!result.ok) return setError(translated(result.message, en.driverReport.api, t.api));
    // The report is stored: drop the local copies of the files and the answers.
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]);
    setDescription("");
    setReceipt(result.complaint);
  };

  if (receipt) {
    return (
      <div className="pn-report" data-testid="driver-receipt">
        <h2 ref={heading} tabIndex={-1} className="pn-report__step">
          {t.sentTitle}
        </h2>
        <div className="pn-driver__receipt">
          <span className="pn-driver__receipt-label">{t.yourReference}</span>
          <span className="pn-driver__reference" data-testid="driver-reference">
            {receipt.reference}
          </span>
        </div>
        <p className="pn-report__status" role="status">
          {form.status(complaintStatusLabel(receipt.status, t))}
        </p>
        <section aria-labelledby={`${uid}-next`} className="pn-report__form">
          <h3 id={`${uid}-next`} className="pn-report__disclosure-title">
            {t.nextTitle}
          </h3>
          <ul className="pn-driver__list">
            {Object.values(t.nextSteps).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
        <Link href={`/app/mynaga?report=${receipt.id}`} className="pn-btn pn-btn--primary pn-report__action" data-testid="driver-mynaga">
          {t.continueMyNaga}
        </Link>
        <Link href="/app/reports" className="pn-btn pn-btn--secondary pn-report__action" data-testid="driver-my-reports">
          {form.seeMyReports}
        </Link>
        <Link href="/app" className="pn-btn pn-btn--secondary pn-report__action">
          {form.backToMap}
        </Link>
      </div>
    );
  }

  return (
    <div className="pn-report" onKeyDown={onKeyDown} data-testid="driver-wizard">
      <p className="pn-report__progress" data-testid="driver-progress">
        {form.stepOf(step, STEPS)}
      </p>
      <h2 ref={heading} tabIndex={-1} className="pn-report__step">
        {t.steps[STEP_KEYS[step]]}
      </h2>

      {step === 1 ? (
        <div className="pn-report__form">
          <div className="pn-driver__emergency" data-testid="driver-emergency">
            <p>
              <strong>{tt.help.emergencyStrong}</strong> {tt.help.emergencyBody}
            </p>
          </div>
          <ul className="pn-driver__list" data-testid="driver-explainer">
            {Object.values(t.explainer).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="pn-report__hint">{t.sharedPhone}</p>
          {!loading && !user ? (
            <div className="pn-report__signin" data-testid="driver-signin">
              <p>{t.signInToSend}</p>
              <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
                {form.signIn}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <CameraCapture
          items={items}
          max={MAX_COMPLAINT_EVIDENCE}
          accept={EVIDENCE_TYPES.join(",")}
          onAdd={addItem}
          onRemove={removeItem}
        />
      ) : null}

      {step === 3 ? (
        <div className="pn-report__form">
          <fieldset className="pn-report__fieldset">
            <legend className="pn-report__label">{t.kindLegend}</legend>
            <div className="pn-group" role="radiogroup" aria-label={t.kindLegend}>
              {complaintCategoryInfo(t).map((c) => (
                <label key={c.value} className="pn-report__option">
                  <input
                    type="radio"
                    name={`${uid}-category`}
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => {
                      setCategory(c.value);
                      setError(null);
                    }}
                  />
                  <span className="pn-report__option-text">
                    <span className="pn-report__option-label">{c.label}</span>
                    <span className="pn-report__option-hint">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="pn-report__field">
            <label htmlFor={`${uid}-desc`} className="pn-report__label">
              {t.whatHappened}
            </label>
            <p id={`${uid}-desc-hint`} className="pn-report__hint">
              {t.whatHint}
            </p>
            <textarea
              id={`${uid}-desc`}
              className="pn-report__input pn-report__textarea"
              rows={6}
              maxLength={COMPLAINT_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={`${uid}-desc-hint ${uid}-count`}
            />
            <span id={`${uid}-count`} className="pn-report__count">
              {form.count(description.trim().length, COMPLAINT_DESCRIPTION_MAX)}
            </span>
          </div>

          <div className="pn-report__field">
            <label htmlFor={`${uid}-when`} className="pn-report__label">
              {t.whenLabel}
            </label>
            <input
              id={`${uid}-when`}
              type="datetime-local"
              className="pn-report__input"
              value={incidentLocal}
              max={localNow()}
              onChange={(e) => setIncidentLocal(e.target.value)}
              aria-describedby={`${uid}-when-hint`}
            />
            <p id={`${uid}-when-hint`} className="pn-report__hint">
              {t.whenHint}
            </p>
          </div>

          <div className="pn-report__field">
            <span className="pn-report__label">{t.whereOptional}</span>
            {gps ? (
              <p className="pn-report__value" data-testid="driver-location">
                {form.locationAdded(gps.accuracyM)}
              </p>
            ) : null}
            <div className="pn-report__row">
              <button
                type="button"
                className="pn-btn pn-btn--secondary pn-report__small"
                onClick={() => {
                  setLocationNote(null);
                  wantFix.current = true;
                  setLocating(true);
                  geo.start();
                }}
                disabled={findingLocation}
                data-testid="driver-add-location"
              >
                {findingLocation ? form.findingLocation : gps ? form.updateLocation : t.useLocation}
              </button>
              {gps ? (
                <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => setGps(null)}>
                  {form.removeLocation}
                </button>
              ) : null}
            </div>
            <p className="pn-report__hint">{form.permissionHint}</p>
            {shownLocationNote ? (
              <p className="pn-report__hint" role="status">
                {shownLocationNote}
              </p>
            ) : null}
            <label htmlFor={`${uid}-place`} className="pn-report__label">
              {t.describePlace}
            </label>
            <input
              id={`${uid}-place`}
              className="pn-report__input"
              maxLength={LOCATION_TEXT_MAX}
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="pn-report__field">
            <label htmlFor={`${uid}-operator`} className="pn-report__label">
              {t.operatorOptional}
            </label>
            <input
              id={`${uid}-operator`}
              className="pn-report__input"
              maxLength={OPERATOR_MAX}
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="pn-driver__pair">
            <div className="pn-report__field">
              <label htmlFor={`${uid}-plate`} className="pn-report__label">
                {t.plateOptional}
              </label>
              <input
                id={`${uid}-plate`}
                className="pn-report__input"
                maxLength={VEHICLE_ID_MAX}
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
            <div className="pn-report__field">
              <label htmlFor={`${uid}-body`} className="pn-report__label">
                {t.bodyOptional}
              </label>
              <input
                id={`${uid}-body`}
                className="pn-report__input"
                maxLength={VEHICLE_ID_MAX}
                value={bodyNumber}
                onChange={(e) => setBodyNumber(e.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
          </div>
          <p className="pn-report__hint">{t.blankHint}</p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="pn-report__form">
          <dl className="pn-group pn-report__summary" data-testid="driver-summary">
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.problem}</dt>
              <dd className="pn-kv__value">{category ? complaintCategoryLabel(category, t) : ""}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.whatHappened}</dt>
              <dd className="pn-kv__value pn-report__wrap">{description.trim()}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.when}</dt>
              <dd className="pn-kv__value">{formatLocal(incidentLocal, locale)}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.where}</dt>
              <dd className="pn-kv__value pn-report__wrap">
                {[gps ? t.locationSummary(gps.accuracyM) : null, locationText.trim() || null].filter(Boolean).join(" · ") || form.notAdded}
              </dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.operator}</dt>
              <dd className="pn-kv__value">{operator.trim() || form.notGiven}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.plate}</dt>
              <dd className="pn-kv__value">{plate.trim() || form.notGiven}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.body}</dt>
              <dd className="pn-kv__value">{bodyNumber.trim() || form.notGiven}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.media}</dt>
              <dd className="pn-kv__value">{items.length}</dd>
            </div>
          </dl>
          <p className="pn-report__hint">{t.reviewerSees}</p>

          <section className="pn-report__disclosure" aria-labelledby={`${uid}-ack`} data-testid="driver-ack-notice">
            <h3 id={`${uid}-ack`} className="pn-report__disclosure-title">
              {t.beforeSend}
            </h3>
            {/* The acknowledgment is English in every language until its verbatim-reviewed translation. */}
            <p className="pn-driver__ack-text">{tt.acknowledgments.driverReport}</p>
            <label className="pn-report__check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="driver-ack" />
              <span>{t.ackCheckbox}</span>
            </label>
          </section>
        </div>
      ) : null}

      {error ? (
        <p className="pn-report__error" role="alert" data-testid="driver-error">
          {error}
        </p>
      ) : null}
      {sending ? (
        <p className="pn-report__hint" role="status">
          {sending}
        </p>
      ) : null}

      <div className="pn-report__nav">
        {step === 1 ? (
          <Link href="/app" className="pn-btn pn-btn--secondary pn-report__action" data-testid="driver-cancel">
            {tt.kit.cancel}
          </Link>
        ) : (
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-report__action"
            onClick={() => go((step - 1) as Step)}
            disabled={sending !== null}
            data-testid="driver-back"
          >
            {form.back}
          </button>
        )}
        {step === 1 && user ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={() => go(2)} data-testid="driver-next">
            {form.continue}
          </button>
        ) : null}
        {step === 2 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={() => go(3)} data-testid="driver-next">
            {items.length > 0 ? form.continue : t.continueNoPhoto}
          </button>
        ) : null}
        {step === 3 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={onNext3} data-testid="driver-next">
            {form.review}
          </button>
        ) : null}
        {step === 4 ? (
          <button
            type="button"
            className="pn-btn pn-btn--primary pn-report__action"
            onClick={() => void onSend()}
            disabled={sending !== null}
            data-testid="driver-send"
          >
            {t.sendPrivately}
          </button>
        ) : null}
      </div>
    </div>
  );
}
