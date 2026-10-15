// Marketing previews of the app screens (design canvas S1, S4, S7), drawn at 390pt and scaled
// into a device frame. Sample content only, and only what the app does today: pins instead of
// search, provisional trips badged unverified, fare estimates, no times, no street path drawn.
import type { ReactNode } from "react";

export function PhoneFrame({ width, children, className = "", bottomless = false }: { width: number; children: ReactNode; className?: string; bottomless?: boolean }) {
  const inner = width - 24;
  const scale = inner / 390;
  const height = Math.round(844 * scale);
  return (
    <div
      aria-hidden
      className={`bg-[#050a14] p-3 shadow-[0_40px_80px_rgba(0,0,0,0.4),inset_0_0_0_2px_rgba(255,255,255,0.08)] ${bottomless ? "rounded-t-[48px] pb-0" : "rounded-[50px]"} ${className}`}
      style={{ width }}
    >
      <div className={`overflow-hidden bg-canvas ${bottomless ? "rounded-t-[38px]" : "rounded-[40px]"}`} style={{ width: inner, height: bottomless ? height * 0.82 : height }}>
        <div style={{ width: 390, height: 844, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{children}</div>
      </div>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-md px-[7px] text-xs font-bold text-white" style={{ background: color }}>
      {label}
    </span>
  );
}

function LeafletMap({ height }: { height: number }) {
  return (
    <svg width="390" height={height} viewBox={`0 0 390 ${height}`} className="absolute inset-0">
      <rect width="390" height={height} fill="#F2EFE9" />
      <g fill="#E0DBD2">
        <rect x="14" y="20" width="62" height="58" /><rect x="14" y="96" width="58" height="92" /><rect x="160" y="18" width="70" height="44" />
        <rect x="166" y="78" width="54" height="84" /><rect x="150" y="228" width="60" height="44" /><rect x="14" y="384" width="66" height="70" />
      </g>
      <rect x="40" y="250" width="90" height="70" fill="#CDEBB0" />
      <path d="M250 0 C 230 120 320 200 300 320 S 160 470 190 600" fill="none" stroke="#AAD3DF" strokeWidth="34" />
      <g fill="none" strokeLinecap="round">
        <path d="M90 0 L 150 844" stroke="#D9D3C7" strokeWidth="10" /><path d="M90 0 L 150 844" stroke="#fff" strokeWidth="8.5" />
        <path d="M0 210 L 390 180" stroke="#E3B87A" strokeWidth="15" /><path d="M0 210 L 390 180" stroke="#FCD6A4" strokeWidth="12.5" />
        <path d="M0 360 C 120 350 220 380 390 340" stroke="#E3B87A" strokeWidth="13" /><path d="M0 360 C 120 350 220 380 390 340" stroke="#FCD6A4" strokeWidth="10.5" />
      </g>
      <circle cx="128" cy="205" r="9" fill="#0B7A75" stroke="#fff" strokeWidth="3" />
      <circle cx="262" cy="124" r="12" fill="#C73A2F" /><circle cx="262" cy="124" r="5" fill="#fff" />
      <circle cx="112" cy="250" r="22" fill="#2BB5AE" opacity="0.25" /><circle cx="112" cy="250" r="9" fill="#0B7A75" stroke="#fff" strokeWidth="3.5" />
      <text x="244" y="128" textAnchor="end" fontSize="11" fontWeight="600" fill="#9E2A21" stroke="#F2EFE9" strokeWidth="3" paintOrder="stroke">SM City Naga</text>
      <text x="136" y="234" fontSize="11" fontWeight="600" fill="#24324F">Plaza Rizal</text>
    </svg>
  );
}

export function HomePreview() {
  return (
    <div className="relative h-[844px] w-[390px] overflow-hidden bg-[#F2EFE9] text-navy">
      <LeafletMap height={420} />
      <div className="absolute right-0 top-[386px] rounded-tl-md bg-white/75 px-1.5 text-[10px] leading-[18px] text-ink-2">Leaflet | © OpenStreetMap contributors</div>
      <div className="absolute inset-x-0 bottom-0 top-[404px] rounded-t-[28px] bg-white px-4 pt-2 shadow-[0_-8px_32px_rgba(15,30,61,0.14)]">
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-navy/25" />
        <div className="rounded-[14px] bg-fill text-[17px]">
          <p className="flex h-[52px] items-center gap-3 rounded-[14px] px-3.5 font-semibold shadow-[inset_0_0_0_2px_#0B7A75]">
            <span className="size-3.5 rounded-full bg-teal" />Your location
          </p>
          <p className="flex h-[52px] items-center gap-3 px-3.5 text-ink-2">
            <span className="size-3.5 rounded-full bg-coral" />Where to?
          </p>
        </div>
        <p className="mt-3.5 flex min-h-12 items-center gap-3 border-b border-navy/8 text-[17px] font-semibold"><PinIcon />Choose on map</p>
        <p className="mb-1 mt-4 text-xl font-bold tracking-tight">Nearby stops</p>
        <StopRow name="Plaza Rizal (A1)" chips={[["Loop A", "#3E4C6B"]]} />
        <StopRow name="Plaza Rizal (B1)" chips={[["Loop B", "#3E4C6B"]]} />
      </div>
    </div>
  );
}

function StopRow({ name, chips }: { name: string; chips: [string, string][] }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-navy/8">
      <span className="size-[22px] rounded-full border-[4px] border-[#E8A317] bg-white" />
      <span className="flex flex-col gap-1">
        <strong className="text-[17px] font-semibold">{name}</strong>
        <span className="flex items-center gap-1.5 text-[13px] text-ink-2">{chips.map(([l, c]) => <Chip key={l} label={l} color={c} />)}Mapped candidate · not yet verified</span>
      </span>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" /><circle cx="12" cy="9.8" r="2.2" fill="currentColor" />
    </svg>
  );
}

function Badge() {
  return <span className="inline-flex self-start rounded-full bg-[#FFF4DC] px-2.5 py-1 text-[13px] font-semibold text-[#7A5200]">Unverified route — confirm with the driver</span>;
}

export function TripPreview() {
  return (
    <div className="h-[844px] w-[390px] bg-canvas px-4 pt-14 text-navy">
      <p className="text-[34px] font-bold tracking-tight">Trip options</p>
      <div className="mt-3 rounded-2xl bg-white px-3.5 py-1 text-[17px]">
        <p className="flex min-h-11 items-center border-b border-navy/8">Your location</p>
        <p className="flex min-h-11 items-center font-semibold">Pinned location</p>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-[22px] bg-white p-4 shadow-[0_0_0_2px_#0B7A75]">
        <span className="text-[13px] font-bold uppercase tracking-wide text-teal-ink">Recommended · Fewest transfers</span>
        <Badge />
        <p className="text-[24px] font-bold tracking-tight">Ride ≈ 1.8 km <span className="text-[15px] font-normal text-ink-2">Time not available</span></p>
        <span className="flex items-center gap-2 text-[13px] text-ink-2">walk ≈ 230 m · <Chip label="Loop A" color="#3E4C6B" /> · walk ≈ 140 m</span>
        <span className="inline-flex self-start rounded-full px-2.5 py-1 text-[13px] font-semibold text-gold-ink shadow-[inset_0_0_0_1.5px_#e8a317]">Estimate ₱14–₱17</span>
      </div>
      <div className="mt-3 flex flex-col gap-3 rounded-[22px] bg-white p-4">
        <span className="text-[13px] font-bold uppercase tracking-wide text-ink-2">Least walking</span>
        <Badge />
        <span className="flex items-center gap-2"><Chip label="Loop B" color="#3E4C6B" /> → <Chip label="Loop A" color="#3E4C6B" /></span>
      </div>
    </div>
  );
}

export function RidePreview() {
  return (
    <div className="relative h-[844px] w-[390px] overflow-hidden bg-[#F2EFE9] text-navy">
      <LeafletMap height={380} />
      <div className="absolute inset-x-0 bottom-0 top-[360px] rounded-t-[28px] bg-white px-4 pt-5">
        <p className="text-sm"><Chip label="Loop A" color="#3E4C6B" /> clockwise (from pin order)</p>
        <p className="mt-3 text-[22px] font-bold tracking-tight">Board Loop A at Plaza Rizal (A1)</p>
        <p className="mt-1 text-[15px] text-ink-2">Signboard not yet verified · ride 4 stops</p>
        <div className="mt-4 flex items-center gap-1">
          <span className="size-3 rounded-full bg-navy" /><span className="h-1 flex-1 rounded bg-[#3E4C6B]" />
          <span className="size-4 rounded-full bg-[#3E4C6B]" /><span className="h-1 flex-1 rounded bg-fill" />
          <span className="size-4 rounded-full bg-coral" />
        </div>
        <div className="mt-6 rounded-[22px] bg-coral p-5 text-white">
          <p className="text-[34px] font-extrabold tracking-tight">Para!</p>
          <p className="mt-1 text-[15px] text-white/85">Get off at the stop your trip names. Say it to the driver as you near it.</p>
        </div>
      </div>
    </div>
  );
}
