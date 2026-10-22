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
  ENTITY_TYPES,
  isEntityType,
  isCorrectionCategory,
  type CorrectionCategory,
  type EntityType,
} from "@/domain/corrections/categories";
import { parseReportEntity } from "@/domain/corrections/href";
import {
  correctionLocationSchema,
  DESCRIPTION_MAX,
  MAX_EVIDENCE_PHOTOS,
  validateDescription,
  validateWhatsWrong,
  type CorrectionLocation,
} from "@/domain/corrections/schemas";
import { statusLabel, type CorrectionStatus } from "@/domain/corrections/status";
import { en, translated } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

type Step = 1 | 2 | 3;
type Photo = { id: string; name: string };

const STEP_KEYS = { 1: "what", 2: "saw", 3: "review" } as const;

export function ReportWizard() {
  const tt = useT();
  const t = tt.report;
  const form = tt.forms;
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
  const [sent, setSent] = useState<{ status: CorrectionStatus } | null>(null);
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
        setLocationNote(t.outsideNaga);
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
      ? t.locationOff
      : locating && geoFailed
        ? t.locationFailed
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
  const categories = categoriesFor(entityType, t);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const onNext1 = () => {
    const problem = validateWhatsWrong(category, tt);
    if (problem) return setError(problem);
    go(2);
  };
  const onNext2 = () => {
    if (!entityType) return setError(t.chooseEntity);
    if (!entityId) return setError(t.sayWhich);
    const problem = validateDescription(description, tt);
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
    else setPhotoNote(translated(result.message, en.report.api, t.api));
  };

  const onSend = async () => {
    if (!user) return;
    if (!accepted) return setError(t.tickBox);
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
    if (result.ok) setSent({ status: result.correction.status });
    else setError(translated(result.message, en.report.api, t.api));
  };

  if (sent) {
    return (
      <div className="pn-report" onKeyDown={onKeyDown} data-testid="report-done">
        <h2 ref={heading} tabIndex={-1} className="pn-report__step">
          {t.sentTitle}
        </h2>
        <p className="pn-report__status" role="status">
          {form.status(statusLabel(sent.status, t))}
        </p>
        <p className="pn-report__body">{t.sentBody}</p>
        <Link href="/app/reports" className="pn-btn pn-btn--secondary pn-report__action" data-testid="report-my-reports">
          {form.seeMyReports}
        </Link>
        <Link href="/app" className="pn-btn pn-btn--primary pn-report__action">
          {form.backToMap}
        </Link>
      </div>
    );
  }

  return (
    <div className="pn-report" onKeyDown={onKeyDown} data-testid="report-wizard">
      <p className="pn-report__progress" data-testid="report-progress">
        {form.stepOf(step, 3)}
      </p>
      <h2 ref={heading} tabIndex={-1} className="pn-report__step">
        {t.steps[STEP_KEYS[step]]}
      </h2>

      {step === 1 ? (
        <fieldset className="pn-report__fieldset">
          <legend className="pn-report__legend">{t.pickClosest}</legend>
          <div className="pn-group" role="radiogroup" aria-label={t.whatIsWrong}>
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
              <span className="pn-report__chip">{t.entity[prefilled.entityType]}</span>
              <span>{entityName}</span>
            </p>
          ) : (
            <>
              <div className="pn-report__field">
                <label htmlFor={`${uid}-etype`} className="pn-report__label">
                  {t.whatAbout}
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
                  <option value="">{t.chooseOne}</option>
                  {ENTITY_TYPES.map((e) => (
                    <option key={e} value={e}>
                      {t.entity[e]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pn-report__field">
                <label htmlFor={`${uid}-ename`} className="pn-report__label">
                  {t.nameOrCode}
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
            <p className="pn-report__chosen">{t.problem(categoryLabel(category, t))}</p>
          ) : null}

          <div className="pn-report__field">
            <label htmlFor={`${uid}-desc`} className="pn-report__label">
              {t.whatDidYouSee}
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
              {form.count(description.trim().length, DESCRIPTION_MAX)}
            </span>
          </div>

          <div className="pn-report__field">
            <span className="pn-report__label">{t.whereOptional}</span>
            {location ? (
              <p className="pn-report__value" data-testid="report-location">
                {form.locationAdded(location.accuracyM)}
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
                {findingLocation ? form.findingLocation : location ? form.updateLocation : t.addLocation}
              </button>
              {location ? (
                <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => setLocation(null)}>
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
          </div>

          <div className="pn-report__field">
            <span className="pn-report__label">{t.photosOptional}</span>
            {photos.length > 0 ? (
              <ul className="pn-report__photos" data-testid="report-photos">
                {photos.map((p) => (
                  <li key={p.id}>
                    <span className="pn-report__photo-name">{p.name}</span>
                    <button
                      type="button"
                      className="pn-btn pn-btn--secondary pn-report__small"
                      onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}
                      aria-label={t.removePhoto(p.name)}
                    >
                      {form.remove}
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
                  {uploading ? t.uploading : t.addPhoto}
                </label>
              </>
            ) : null}
            {!user && !loading ? <p className="pn-report__hint">{t.signInPhotos}</p> : null}
            <p className="pn-report__hint">{t.photosHint(MAX_EVIDENCE_PHOTOS)}</p>
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
              <dt className="pn-kv__key">{t.summary.whatsWrong}</dt>
              <dd className="pn-kv__value">{category ? categoryLabel(category, t) : ""}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.about}</dt>
              <dd className="pn-kv__value">
                {entityType ? t.entity[entityType] : ""} · {entityName}
              </dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.whatYouSaw}</dt>
              <dd className="pn-kv__value pn-report__wrap">{description.trim()}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.location}</dt>
              <dd className="pn-kv__value">{location ? t.locationSummary(location.accuracyM) : form.notAdded}</dd>
            </div>
            <div className="pn-kv">
              <dt className="pn-kv__key">{t.summary.photos}</dt>
              <dd className="pn-kv__value">{photos.length}</dd>
            </div>
          </dl>

          <section className="pn-report__disclosure" aria-labelledby={`${uid}-ai`} data-testid="report-disclosure">
            <h3 id={`${uid}-ai`} className="pn-report__disclosure-title">
              {t.disclosure.title}
            </h3>
            <ul>
              {Object.values(t.disclosure.points).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <label className="pn-report__check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="report-ack" />
              <span>{t.disclosure.checkbox}</span>
            </label>
          </section>

          {!loading && !user ? (
            <div className="pn-report__signin" data-testid="report-signin">
              <p>{t.signInToSend}</p>
              <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
                {form.signIn}
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
            {form.back}
          </button>
        ) : null}
        {step === 1 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={onNext1} data-testid="report-next">
            {form.continue}
          </button>
        ) : null}
        {step === 2 ? (
          <button type="button" className="pn-btn pn-btn--primary pn-report__action" onClick={onNext2} data-testid="report-next">
            {form.review}
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
            {sending ? form.sending : t.send}
          </button>
        ) : null}
      </div>
    </div>
  );
}
