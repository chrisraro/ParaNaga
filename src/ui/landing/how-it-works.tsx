"use client";

import { useState } from "react";
import { PhoneFrame, RidePreview, SearchPreview, TripPreview } from "@/ui/landing/phone-screens";

const STEPS = [
  { title: "Search a place", body: "Type a landmark, barangay or stop. Local names like Centro or Diversion work too.", screen: <SearchPreview /> },
  { title: "Pick a verified trip", body: "Compare options by walking, transfers and fare, with every unknown marked.", screen: <TripPreview /> },
  { title: "Walk, ride, Para!", body: "Step-by-step guidance to the right curb, the right signboard and the right stop.", screen: <RidePreview /> },
];

export function HowItWorks() {
  const [step, setStep] = useState(0);
  return (
    <section id="how" aria-labelledby="how-h" className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-12 px-4 pt-16 md:px-8 md:pt-28">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-5">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.08em] text-teal">How it works</span>
        <h2 id="how-h" className="text-[clamp(32px,4.4vw,52px)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          From &ldquo;where to?&rdquo; to &ldquo;Para!&rdquo; in three steps.
        </h2>
        <ol className="mt-2 flex flex-col gap-2.5">
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  aria-pressed={on}
                  className={`flex w-full items-start gap-4 rounded-[20px] p-[18px] text-left transition-[background-color,box-shadow,transform] duration-300 ease-sheet active:scale-[0.98] ${
                    on ? "bg-white shadow-[0_10px_30px_rgba(15,30,61,0.08),inset_0_0_0_1.5px_#0b7a75]" : "shadow-[inset_0_0_0_1px_rgba(15,30,61,0.08)] hover:bg-white/60"
                  }`}
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${on ? "bg-teal text-white" : "bg-fill text-ink-2"}`}>{i + 1}</span>
                  <span className="flex flex-col gap-1">
                    <strong className="text-lg font-bold tracking-tight">{s.title}</strong>
                    <span className="text-[15px] leading-normal text-ink-2">{s.body}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-[1_1_320px] justify-center">
        <PhoneFrame width={300}>
          <div key={step} className="animate-rise">{STEPS[step]?.screen}</div>
        </PhoneFrame>
      </div>
    </section>
  );
}
