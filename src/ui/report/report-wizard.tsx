"use client";

// Report a correction (S16, F-D1, task B6): 1 What's wrong -> 2 Tell us what you saw -> 3 Review
// and send. Guests can read and fill it in; sending needs an account. A correction is a proposal
// for a reviewer: it never changes the map, routes or fares by itself.
//
// Focus moves to the step heading on every step change. Escape steps out one step (the page's own
// Escape-to-close only runs when the key is not already handled here); the Back button does the same.

import "@/ui/kit/styles";
import "./report.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { submitCorrection, uploadEvidencePhoto } from "@/client/corrections/api";
import { useGeolocation } from "@/client/geo/use-geolocation";
import {
  categoriesFor,
  categoryLabel,
  ENTITY_LABELS,
  ENTITY_TYPES,
  isEntityType,
  isCorrectionCategory,
  type CorrectionCategory,
  type EntityType,
} from "@/domain/corrections/categories";
import {
  AI_DISCLOSURE_CHECKBOX,
  AI_DISCLOSURE_POINTS,
  AI_DISCLOSURE_TITLE,
} from "@/domain/corrections/disclosure";
import { parseReportEntity } from "@/domain/corrections/href";
import {
  correctionLocationSchema,
  DESCRIPTION_MAX,
  MAX_EVIDENCE_PHOTOS,
  validateDescription,
  validateWhatsWrong,
  type CorrectionLocation,
} from "@/domain/corrections/schemas";
import { statusLabel } from "@/domain/corrections/status";

type Step = 1 | 2 | 3;
type Photo = { id: string; name: string };

const STEP_TITLES: Record<Step, string> = {
  1: "What's wrong",
  2: "Tell us what you saw",
  3: "Review and send",
};

export function ReportWizard() {
  const uid = useId();
  const params = useSearchParams();
  const prefilled = parseReportEntity(params);
  const { user, loading } = useAuthSession();

  const [step, setStep] = useState<Step>(1);
  const [category, setCategory] = useState<CorrectionCategory | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(prefilled?.entityType ?? null);
  const [entityText, setEntityText] = useState(prefilled ? (prefilled.entityLabel ?? prefilled.entityId) : "");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<CorrectionLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ status: string } | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const wantFix = useRef(false);
  const stopGeo = useRef<() => void>(() => undefined);
  // A requested location arrives as a fix; keep it once, then stop watching (battery, privacy).
  const geo = useGeolocation({
    onFix: (fix) => {
      if (!wantFix.current) return;
      wantFix.current = false;
      const parsed = correctionLocationSchema.safeParse({ lat: fix.lat, lng: fix.lng, accuracyM: Math.round(fix.accuracy) });
      if (parsed.success) {
        setLocation(parsed.data);
        setLocationNote(null);
      } else {
        setLocationNote("This spot is outside Naga City, so it was not added.");
      }
      setLocating(false);
      stopGeo.current();
    },
  });
  useEffect(() => {
    stopGeo.current = geo.stop;
  });
  const geoFailed = geo.state === "denied" || geo.state === "unavailable" || geo.state === "timeout" || geo.state === "unsupported" || geo.state === "insecure";
  const findingLocation = locating && !geoFailed;
  const shownLocationNote =
    locationNote ??
    (locating && geo.state === "denied"
      ? "Location is off for ParaNaga. You can still send the report without it."
      : locating && geoFailed
        ? "Your location could not be found. You can still send the report without it."
        : null);


  // Focus the step heading whenever the step (or the done screen) changes. Not on first render:
  // the page frame has just put focus on the page title, as on every screen.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, sent]);

  const entityId = entityText.trim();
  const entityName = prefilled?.entityLabel ?? entityId;
  const categories = categoriesFor(entityType);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const onNext1 = () => {
    const problem = validateWhatsWrong(category);
    if (problem) return setError(problem);
    go(2);
  };
  const onNext2 = () => {
    if (!entityType) return setError("Choose what this is about.");
    if (!entityId) return setError("Say which stop, route, fare or trip this is about.");
    const problem = validateDescription(description);
    if (problem) return setError(problem);
    go(3);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || sent || step === 1) return;
    e.preventDefault(); // handled here: the page's Escape-to-close must not also run
    go((step - 1) as Step);
  };

  const onPickPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoNote(null);
    const result = await uploadEvidencePhoto(file);
    setUploading(false);
    if (result.ok) setPhotos((p) => [...p, { id: result.mediaId, name: file.name.slice(0, 60) }]);
    else setPhotoNote(result.message);
  };

  const onSend = async () => {
    if (!user) return;
    if (!accepted) return setError("Tick the box to confirm you have read how reports are checked.");
    if (!category || !entityType) return;
    setSending(true);
    setError(null);
    const result = await submitCorrection({
      clientRequestId: requestId,
      category,
      entityType,
      entityId: prefilled?.entityId ?? entityId,
      ...(entityName ? { entityLabel: entityName.slice(0, 120) } : {}),
      description: description.trim(),
      ...(location ? { location } : {}),
      mediaIds: photos.map((p) => p.id),
      aiDisclosureAccepted: true,
    });
    setSending(false);
    if (result.ok) setSent({ status: statusLabel(result.correction.status) });
    else setError(result.message);
  };

  if (sent) {
    return (
      <div className="pn-report" onKeyDown={onKeyDown} data-testid="report-done">
        <h2 ref={heading} tabIndex={-1} className="pn-report__step">
          Report sent
        </h2>
        <p className="pn-report__status" role="status">
          Status: {sent.status}
        </p>
        <p className="pn-report__body">A person will review it. Nothing on the map, routes or fares changes until that review is done and the data is republished.</p>
        <Link href="/app" className="pn-btn pn-btn--primary pn-report__action">
          Back to the map
        </Link>
      </div>
    );
  }

  return (
    <div className="pn-report" onKeyDown={onKeyDown} data-testid="report-wizard">
      <p className="pn-report__progress" data-testid="report-progress">
        Step {step} of 3
      </p>
      <h2 ref={heading} tabIndex={-1} className="pn-report__step">
        {STEP_TITLES[step]}
      </h2>

      {step === 1 ? (
        <fieldset className="pn-report__fieldset">
          <legend className="pn-report__legend">Pick the closest match</legend>
          <div className="pn-group" role="radiogroup" aria-label="What is wrong">
            {categories.map((c) => (
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
      ) : null}

      {step === 2 ? (
        <div className="pn-report__form">
          {prefilled ? (
            <p className="pn-report__entity" data-testid="report-entity">
              <span className="pn-report__chip">{ENTITY_LABELS[prefilled.entityType]}</span>
              <span>{entityName}</span>
            </p>
          ) : (
            <>
              <div className="pn-report__field">
                <label htmlFor={`${uid}-etype`} className="pn-report__label">
                  What is it about?
                </label>
                <select
                  id={`${uid}-etype`}
                  className="pn-report__input"
                  value={entityType ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEntityType(isEntityType(v) ? v : null);
                    setCategory((c) => (c && isEntityType(v) && !categoriesFor(v).some((x) => x.value === c) ? null : c));
                  }}
                >
                  <option value="">Choose one</option>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ENTITY_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pn-report__field">
                <label htmlFor={`${uid}-ename`} className="pn-report__label">
                  Name or code
                </label>
                <input
                  id={`${uid}-ename`}
                  className="pn-report__input"
                  maxLength={120}
                  value={entityText}
                  onChange={(e) => setEntityText(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          {category && isCorrectionCategory(category) ? (
            <p className="pn-report__chosen">Problem: {categoryLabel(category)}</p>
          ) : null}

          <div className="pn-report__field">
            <label htmlFor={`${uid}-desc`} className="pn-report__label">
              What did you see?
            </label>
            <textarea
              id={`${uid}-desc`}
              className="pn-report__input pn-report__textarea"
              rows={5}
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={`${uid}-count`}
            />
            <span id={`${uid}-count`} className="pn-report__count">
              {description.trim().length} of {DESCRIPTION_MAX}
            </span>
          </div>

          <div className="pn-report__field">
            <span className="pn-report__label">Where you saw it (optional)</span>
            {location ? (
              <p className="pn-report__value" data-testid="report-location">
                Location added, accurate to about {location.accuracyM} m.
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
                data-testid="report-add-location"
              >
                {findingLocation ? "Finding your location…" : location ? "Update my location" : "Add my location"}
              </button>
              {location ? (
                <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => setLocation(null)}>
                  Remove location
                </button>
              ) : null}
            </div>
            <p className="pn-report__hint">Your phone asks for permission only when you tap the button.</p>
            {shownLocationNote ? (
              <p className="pn-report__hint" role="status">
                {shownLocationNote}
              </p>
            ) : null}
          </div>

          <div className="pn-report__field">
            <span className="pn-report__label">Photos (optional)</span>
            {photos.length > 0 ? (
              <ul className="pn-report__photos" data-testid="report-photos">
                {photos.map((p) => (
                  <li key={p.id}>
                    <span className="pn-report__photo-name">{p.name}</span>
                    <button
                      type="button"
                      className="pn-btn pn-btn--secondary pn-report__small"
                      onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}
                      aria-label={`Remove photo ${p.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {user && photos.length < MAX_EVIDENCE_PHOTOS ? (
              <>
                <input
                  id={`${uid}-photo`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="pn-report__file"
                  disabled={uploading}
                  onChange={(e) => {
                    void onPickPhoto(e.target.files);
                    e.target.value = "";
                  }}
                />
                <label htmlFor={`${uid}-photo`} className="pn-btn pn-btn--secondary pn-report__small" aria-disabled={uploading}>
                  {uploading ? "Uploading…" : "Add a photo"}
                </label>
              </>
            ) : null}
            {!user && !loading ? <p className="pn-report__hint">Sign in to attach photos.</p> : null}
            <p className="pn-report__hint">Up to {MAX_EVIDENCE_PHOTOS} photos. Location data is removed from photos.</p>
            {photoNote ? (
              <p className="pn-report__hint" role="status">
                {photoNote}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="pn-report__form">
          <dl className="pn-group pn-report__summary" data-testid="report-summary">
            <div className="pn-kv">
              <dt className="pn-kv__key">{"What's wrong"}</dt>
              <dd className="pn-kv__value">{category ? categoryLabel(category) : ""}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">About</dt>
              <dd className="pn-kv__value">
                {entityType ? ENTITY_LABELS[entityType] : ""} · {entityName}
              </dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">What you saw</dt>
              <dd className="pn-kv__value pn-report__wrap">{description.trim()}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">Location</dt>
              <dd className="pn-kv__value">{location ? `Added, about ${location.accuracyM} m` : "Not added"}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">Photos</dt>
              <dd className="pn-kv__value">{photos.length}</dd>
            </div>
          </dl>

          <section className="pn-report__disclosure" aria-labelledby={`${uid}-ai`} data-testid="report-disclosure">
            <h3 id={`${uid}-ai`} className="pn-report__disclosure-title">
              {AI_DISCLOSURE_TITLE}
            </h3>
            <ul>
              {AI_DISCLOSURE_POINTS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <label className="pn-report__check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="report-ack" />
              <span>{AI_DISCLOSURE_CHECKBOX}</span>
            </label>
          </section>

          {!loading && !user ? (
            <div className="pn-report__signin" data-testid="report-signin">
              <p>Sign in to send this report. An account is only needed to send; everything else works as a guest.</p>
              <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
                Sign in
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="pn-report__error" role="alert" data-testid="report-error">
          {error}
        </p>
      ) : null}

      <div className="pn-report__nav">
        {step > 1 ? (
          <button type="button" className="pn-btn pn-btn--secondary pn-report__action" onClick={() => go((step - 1) as Step)} data-testid="report-back">
            Back
          </button>
        ) : null}
        {step === 1 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={onNext1} data-testid="report-next">
            Continue
          </button>
        ) : null}
        {step === 2 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={onNext2} data-testid="report-next">
            Review
          </button>
        ) : null}
        {step === 3 && user ? (
          <button
            type="button"
            className="pn-btn pn-btn--primary pn-report__action"
            onClick={() => void onSend()}
            disabled={sending}
            data-testid="report-send"
          >
            {sending ? "Sending…" : "Send report"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
