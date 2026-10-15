import Link from "next/link";
import { RouteNMark, Wordmark } from "@/ui/brand/route-n-mark";
import { HowItWorks } from "@/ui/landing/how-it-works";
import { HomePreview, PhoneFrame } from "@/ui/landing/phone-screens";
import { SiteHeader } from "@/ui/landing/site-header";

// Marketing landing page (design canvas: W1 · Landing page). Copy rules (spec §6.5):
// never "live", "official" or "guaranteed"; no invented counts, ratings or testimonials.
// Honest about what ships: trips are provisional (Loops A and B, unverified pins, fare
// estimates); features still being built say "Coming soon" and are never promised as done.
//
// Audit F-23: in production, Chrome may warn that /app CSS chunks were "preloaded but not used".
// Those <link rel=preload as=style> tags are added by Next's prefetch of the <Link href="/app">
// links below (framework behaviour, it makes opening the app fast), not by this page.

const ROUTES: [string, string][] = [
  ["San Felipe", "#2F6FE4"], ["Pacol", "#7B4FD6"], ["Del Rosario · Magsaysay", "#0D827D"], ["Del Rosario · Roxas", "#B25E15"],
  ["Del Rosario · Panganiban", "#976E09"], ["Carolina–Panicuason", "#2C854C"], ["San Isidro · Cararayan", "#C94177"], ["Magsaysay Loops A–D", "#3E4C6B"],
];

const QUESTIONS = [
  { title: "Where do I wait?", body: "The mapped stop to walk to, and where its pin comes from. Curb sides aren't surveyed yet, and we say so.", icon: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5", tone: "bg-teal-soft text-teal-ink" },
  { title: "What do I ride?", body: "The route and its direction. Signboard text shows once it's verified; until then, confirm with the driver.", icon: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4zM4 11h16M7 19l-1 2M17 19l1 2M7.5 15.5h.01M16.5 15.5h.01", tone: "bg-[#E0E9FB] text-[#1F4FB0]" },
  { title: "Where do I transfer?", body: "Where to get off, how far to walk and which loop to board next, with every distance marked as an estimate.", icon: "M7 4v10M7 14l-3-3M7 14l3-3M17 20V10M17 10l-3 3M17 10l3 3", tone: "bg-fill text-navy" },
  { title: "When do I say Para?", body: "Your trip steps name the stop to get off at, so you know when to call it.", icon: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0", tone: "bg-coral-soft text-coral-ink" },
];

const FEATURES = [
  { title: "No account needed", soon: false, body: "Plan as a guest. Signing in to keep saved places is coming soon.", icon: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" },
  { title: "Readable outdoors", soon: false, body: "High contrast, large type and big buttons that work one-handed in the sun.", icon: "M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  { title: "Honest about unknowns", soon: false, body: "Unverified routes, estimated fares and unsurveyed stops are labelled as such, every time.", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16h.01" },
  { title: "Works without signal", soon: true, body: "Saved trips and places that open offline, so a dead zone never strands you.", icon: "M6 3h12v18l-6-4.5L6 21z" },
  { title: "Place search", soon: true, body: "Type a landmark, barangay or stop instead of pinning it on the map.", icon: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5" },
  { title: "Corrections and driver reports", soon: true, body: "Spot a moved stop or a problem on the road? Report it, privately when it's about a driver.", icon: "M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2.3.7 4 2.9 4 5.5" },
];

const FAQ = [
  ["Is ParaNaga free?", "Yes. Planning trips and exploring routes is free and works without an account."],
  ["Why does it only open on phones?", "ParaNaga is a street companion: it uses your location, the map and big tap targets while you walk and ride. On a computer we show a QR code so you can open it on your phone instead."],
  ["Do I need to install anything?", "No. It runs in your phone's browser. You can add it to your home screen for one-tap access. Offline saved trips are coming soon."],
  ["Can I trust the routes?", "Not blindly, yet. Trips are planned on mapped Loop A and B stops that haven't been checked on the street, so every ride says \u201cUnverified route \u2014 confirm with the driver\u201d, and fares are estimates from reported fare rules."],
  ["Does it show where the jeepney is right now?", "No. ParaNaga does not track vehicles. It shows mapped routes and stops with fare estimates, and tells you clearly when something is not yet verified."],
  ["Is this the City Government's app?", "No. ParaNaga is independent and not affiliated with the City Government of Naga. For official complaints, contact the City directly."],
];

function Icon({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function PhoneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" />
    </svg>
  );
}

const sectionTitle = "font-extrabold tracking-[-0.035em] leading-[1.04] text-[clamp(32px,4.4vw,52px)]";
const ctaPrimary =
  "inline-flex items-center gap-2.5 rounded-full bg-teal-bright font-bold text-on-teal-bright shadow-[0_12px_32px_rgba(43,181,174,0.35)] transition-transform active:scale-[0.97]";

export function LandingPage() {
  return (
    <div className="overflow-x-clip bg-canvas text-navy">
      <SiteHeader />

      {/* One <main> landmark for everything between the header and the footer (axe: landmark-one-main, region). */}
      <main>
      <section id="top" aria-labelledby="hero-h" className="relative scroll-mt-16 overflow-hidden bg-navy text-white" style={{ background: "radial-gradient(1200px 600px at 85% 10%, #1d3870 0%, rgba(29,56,112,0) 60%), #0f1e3d" }}>
        <svg viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" aria-hidden className="absolute inset-0 size-full opacity-55">
          <path className="route-draw animate-draw" d="M-40 640 C 240 600 300 420 520 420 S 820 560 1000 440 S 1300 200 1500 240" fill="none" stroke="#2BB5AE" strokeWidth="3" strokeLinecap="round" />
          <path className="route-draw animate-draw [animation-delay:0.7s]" d="M-40 300 C 200 340 380 200 600 260 S 980 420 1180 300 S 1400 120 1500 140" fill="none" stroke="#F26B5B" strokeWidth="3" strokeLinecap="round" />
          <circle cx="520" cy="420" r="7" fill="#0F1E3D" stroke="#fff" strokeWidth="3" />
          <circle cx="1000" cy="440" r="7" fill="#0F1E3D" stroke="#fff" strokeWidth="3" />
          <circle cx="600" cy="260" r="7" fill="#0F1E3D" stroke="#fff" strokeWidth="3" />
        </svg>
        <div className="relative mx-auto flex max-w-[1180px] flex-wrap items-end gap-12 px-4 pt-14 md:px-8 md:pt-28">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-5 pb-10 md:pb-28">
            <span className="inline-flex h-8 animate-rise items-center gap-2 self-start rounded-full bg-white/10 px-3.5 text-[13px] font-semibold text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">
              <span className="size-2 rounded-full bg-teal-bright" />Now on the web · Naga City, Camarines Sur
            </span>
            <h1 id="hero-h" className="animate-rise text-[clamp(44px,7vw,84px)] font-extrabold leading-[0.98] tracking-[-0.045em] [animation-delay:0.12s]">
              Know your ride.<br /><span className="text-teal-bright">Find your way.</span>
            </h1>
            <p className="max-w-[520px] animate-rise text-[clamp(17px,1.6vw,20px)] leading-normal text-white/80 [animation-delay:0.24s]">
              Where to wait, which jeepney to take, where to transfer and when to say <strong className="text-coral-bright">Para!</strong> ParaNaga turns Naga&apos;s mapped jeepney loops into step-by-step provisional trips, starting with Loops A and B.
            </p>
            <div className="flex animate-rise flex-wrap items-center gap-3 [animation-delay:0.36s]">
              <Link href="/app" className={`${ctaPrimary} h-14 px-6 text-[17px]`}>Open ParaNaga<Arrow /></Link>
              <a href="#how" className="inline-flex h-14 items-center rounded-full bg-white/10 px-5 text-[17px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] transition-transform active:scale-[0.97]">See how it works</a>
            </div>
            <p className="flex animate-rise items-center gap-2 text-sm text-white/70 [animation-delay:0.36s]"><PhoneIcon />Made for your phone. Free, and no account needed.</p>
          </div>
          <div className="mx-auto flex flex-[0_1_340px] justify-center">
            <PhoneFrame width={312} bottomless className="animate-float">
              <HomePreview />
            </PhoneFrame>
          </div>
        </div>
      </section>

      <div aria-label="Routes in the network" className="overflow-hidden bg-navy-deep py-3.5">
        <ul className="flex w-max animate-marquee gap-3">
          {[...ROUTES, ...ROUTES].map(([name, color], i) => (
            <li key={i} aria-hidden={i >= ROUTES.length} className="inline-flex h-[30px] items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-bold text-white" style={{ background: color }}>{name}</li>
          ))}
        </ul>
      </div>

      <section aria-labelledby="q-h" className="mx-auto max-w-[1180px] px-4 pt-16 md:px-8 md:pt-28">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 id="q-h" className={`max-w-[640px] ${sectionTitle}`}>Four questions every commuter asks. Here&apos;s what we can answer today.</h2>
          <p className="max-w-[380px] text-[17px] leading-relaxed text-ink-2">New to Naga, visiting for Peñafrancia, or just trying a new route: you shouldn&apos;t have to ask three strangers which jeepney to take.</p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {QUESTIONS.map((q) => (
            <article key={q.title} className="flex flex-col gap-3.5 rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(15,30,61,0.06)] transition-[transform,box-shadow] duration-500 ease-sheet hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(15,30,61,0.12)]">
              <span className={`flex size-12 items-center justify-center rounded-[14px] ${q.tone}`}><Icon d={q.icon} /></span>
              <h3 className="text-[21px] font-bold tracking-tight">{q.title}</h3>
              <p className="text-[15px] leading-relaxed text-ink-2">{q.body}</p>
            </article>
          ))}
        </div>
      </section>

      <HowItWorks />

      <section id="features" aria-labelledby="feat-h" className="mx-auto scroll-mt-20 max-w-[1180px] px-4 pt-16 md:px-8 md:pt-28">
        <h2 id="feat-h" className={`mb-8 max-w-[720px] ${sectionTitle}`}>Built for the street, not the office.</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
          <article className="flex min-h-[360px] flex-col gap-4 rounded-[28px] bg-navy p-7 text-white sm:row-span-2">
            <span className="text-[44px] font-extrabold tracking-[-0.04em] text-coral-bright">Para!</span>
            <h3 className="text-2xl font-bold tracking-tight">Know where to get off</h3>
            <p className="leading-relaxed text-white/75">Each trip lists the stops you ride past and names the one to get off at. Say Para! to the driver as you near it.</p>
            <div aria-hidden className="mt-auto flex items-center gap-2">
              <span className="size-3 rounded-full bg-teal-bright" />
              <span className="h-1 flex-1 rounded bg-[linear-gradient(90deg,#2bb5ae_0_62%,rgba(255,255,255,0.18)_62%_100%)]" />
              <span className="size-4 rounded-full bg-coral-bright shadow-[0_0_0_6px_rgba(255,138,122,0.2)]" />
            </div>
          </article>
          {FEATURES.map((f) => (
            <article key={f.title} className="flex items-start gap-4 rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(15,30,61,0.06)]">
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${f.soon ? "bg-fill text-ink-2" : "bg-teal-soft text-teal-ink"}`}><Icon d={f.icon} size={22} /></span>
              <span className="flex flex-col gap-1.5">
                <h3 className="text-lg font-bold tracking-tight">{f.title}</h3>
                {f.soon ? <span className="self-start rounded-full bg-fill px-2.5 py-0.5 text-[13px] font-semibold text-ink-2">Coming soon</span> : null}
                <span className="text-[15px] leading-normal text-ink-2">{f.body}</span>
              </span>
            </article>
          ))}
        </div>
      </section>

      <section id="data" aria-labelledby="data-h" className="mx-auto scroll-mt-20 max-w-[1180px] px-4 pt-16 md:px-8 md:pt-28">
        <div className="flex flex-wrap gap-10 rounded-[32px] bg-white p-7 shadow-[0_1px_2px_rgba(15,30,61,0.06)] md:p-14">
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
            <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.08em] text-teal">Honest data</span>
            <h2 id="data-h" className="text-[clamp(30px,4vw,46px)] font-extrabold leading-[1.05] tracking-[-0.035em]">We&apos;d rather say &ldquo;not sure yet&rdquo; than send you the wrong way.</h2>
            <p className="text-[17px] leading-relaxed text-ink-2">Every stop and route carries a badge. Nothing is verified on the street yet, so for now trips use mapped Loop A and B stops, and every ride says &ldquo;Unverified route &mdash; confirm with the driver&rdquo;. Fares are estimates and say so. Coverage grows street by street.</p>
          </div>
          <ul className="flex flex-[1_1_340px] flex-col gap-3">
            <li className="flex items-start gap-3.5 rounded-[18px] bg-canvas p-4">
              <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-teal-soft px-2.5 text-[13px] font-bold text-teal-ink">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>Verified
              </span>
              <span className="text-[15px] leading-normal text-ink-2">Checked against field evidence. None yet: this badge appears as stops are surveyed.</span>
            </li>
            <li className="flex items-start gap-3.5 rounded-[18px] bg-canvas p-4">
              <span className="inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[13px] font-bold text-gold-ink shadow-[inset_0_0_0_1.5px_#e8a317]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden><circle cx="12" cy="12" r="8" /></svg>Mapped candidate
              </span>
              <span className="text-[15px] leading-normal text-ink-2">From public maps, not yet checked. Used for provisional trips, always badged.</span>
            </li>
            <li className="flex items-start gap-3.5 rounded-[18px] bg-canvas p-4">
              <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-fill px-2.5 text-[13px] font-bold text-ink-2">Documented only</span>
              <span className="text-[15px] leading-normal text-ink-2">Named in documents with no mapped location yet.</span>
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="mobile-h" className="mx-auto max-w-[1180px] px-4 pt-16 md:px-8 md:pt-28">
        <div className="flex flex-wrap items-center gap-7 rounded-[32px] bg-[linear-gradient(135deg,#e3f2f1,#ffffff_60%)] p-7 shadow-[inset_0_0_0_1px_rgba(11,122,117,0.18)] md:p-12">
          <span className="flex size-[72px] shrink-0 items-center justify-center rounded-[22px] bg-teal text-white"><PhoneIcon size={34} /></span>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
            <h2 id="mobile-h" className="text-[clamp(24px,3vw,32px)] font-extrabold tracking-[-0.03em]">Best on your phone, by design.</h2>
            <p className="leading-relaxed text-ink-2">ParaNaga guides you on the street, using your location and big tap targets. The app opens only on phones and small tablets. On a computer, we&apos;ll show a QR code so you can continue on your phone in a second.</p>
          </div>
          <Link href="/app" className="inline-flex h-[52px] items-center rounded-full bg-teal px-5 font-bold text-white transition-transform active:scale-[0.97]">Open on my phone</Link>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-h" className="mx-auto scroll-mt-20 max-w-[860px] px-4 pt-16 md:px-8 md:pt-28">
        <h2 id="faq-h" className="mb-6 text-[clamp(32px,4.4vw,48px)] font-extrabold tracking-[-0.035em]">Questions</h2>
        <div className="rounded-3xl bg-white px-6 py-1 shadow-[0_1px_2px_rgba(15,30,61,0.06)]">
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0} className="group border-b border-navy/8 last:border-b-0">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-3.5 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="shrink-0 transition-transform duration-300 ease-sheet group-open:rotate-180">
                  <path d="M3 5l4 4 4-4" />
                </svg>
              </summary>
              <p className="pb-5 leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="cta-h" className="px-4 py-16 md:px-8 md:py-28">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center gap-5 rounded-[36px] px-6 py-12 text-center text-white md:px-16 md:py-22" style={{ background: "radial-gradient(800px 400px at 80% 0%, #1d3870, rgba(29,56,112,0) 70%), #0f1e3d" }}>
          <RouteNMark size={64} />
          <h2 id="cta-h" className="text-[clamp(34px,5vw,60px)] font-extrabold leading-[1.02] tracking-[-0.04em]">Your next ride starts here.</h2>
          <p className="max-w-[520px] text-lg leading-normal text-white/80">Open ParaNaga on your phone&apos;s browser. Add it to your home screen and it works like an app.</p>
          <Link href="/app" className={`${ctaPrimary} h-[58px] px-7 text-lg`}>Open ParaNaga<Arrow /></Link>
          <span className="text-sm text-white/60">Best on mobile · Free · No account needed</span>
        </div>
      </section>
      </main>

      <footer className="border-t border-navy/8 bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-x-12 gap-y-7 px-4 py-10 md:px-8">
          <div className="flex max-w-[460px] flex-[1_1_320px] flex-col gap-2.5">
            <Wordmark className="text-[22px]" />
            <p className="text-[13px] leading-relaxed text-ink-3">ParaNaga is an independent project. It is not affiliated with, endorsed by or an official channel of the City Government of Naga. Route and fare information may be incomplete; always confirm with the driver. Map data © OpenStreetMap contributors.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-10 text-sm">
            <div className="flex flex-col gap-2.5">
              <strong className="text-[13px] text-ink-3">Product</strong>
              <Link href="/app">Open the app</Link>
              <a href="#how">How it works</a>
              <a href="#data">About our data</a>
            </div>
          </nav>
        </div>
      </footer>
    </div>
  );
}
