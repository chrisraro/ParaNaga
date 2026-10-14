// Marketing previews of the app screens (design canvas S1, S2, S4, S7), drawn at 390pt and
// scaled into a device frame. Sample content only: no real times, distances or fares.
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
      <path d="M118 410 L 128 205 L 300 182 L 262 124" fill="none" stroke="#2F6FE4" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
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
        <div className="flex h-[52px] items-center gap-2.5 rounded-[14px] bg-fill px-3.5 text-[17px] text-ink-2">
          <SearchIcon /> Where to?
        </div>
        <div className="mt-3.5 flex gap-2">
          <span className="inline-flex h-10 items-center rounded-full px-3.5 text-[15px] font-semibold shadow-[0_0_0_1px_rgba(15,30,61,0.1)]">SM City Naga</span>
          <span className="inline-flex h-10 items-center rounded-full px-3.5 text-[15px] font-semibold shadow-[0_0_0_1px_rgba(15,30,61,0.1)]">Ateneo de Naga</span>
        </div>
        <p className="mb-1 mt-4 text-xl font-bold tracking-tight">Nearby stops</p>
        <StopRow name="Plaza Rizal stop" chips={[["San Felipe", "#2F6FE4"], ["Pacol", "#7B4FD6"]]} />
        <StopRow name="Centro loading cluster" chips={[["Del Rosario", "#0E8C86"], ["Loop A", "#3E4C6B"]]} />
      </div>
    </div>
  );
}

function StopRow({ name, chips }: { name: string; chips: [string, string][] }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-navy/8">
      <span className="size-[22px] rounded-full border-[3px] border-white bg-teal shadow-[0_0_0_1px_rgba(11,122,117,0.4)]" />
      <span className="flex flex-col gap-1">
        <strong className="text-[17px] font-semibold">{name}</strong>
        <span className="flex gap-1.5">{chips.map(([l, c]) => <Chip key={l} label={l} color={c} />)}</span>
      </span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function SearchPreview() {
  return (
    <div className="h-[844px] w-[390px] bg-canvas px-4 pt-14 text-navy">
      <div className="flex h-11 items-center gap-2 rounded-xl bg-fill px-3 text-[17px]"><SearchIcon />Diversion</div>
      <p className="mb-1.5 ml-1 mt-6 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Places</p>
      <div className="rounded-2xl bg-white px-3.5 py-3">
        <strong className="text-[17px] font-semibold"><span className="text-teal">Diversion</span> Road</strong>
        <p className="text-sm text-ink-2">Road · Concepcion · also called &quot;Diversion&quot;</p>
      </div>
      <p className="mb-1.5 ml-1 mt-5 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Routes</p>
      <div className="rounded-2xl bg-white px-3.5 py-3">
        <strong className="text-[17px] font-semibold"><span className="text-teal">Diversion</span> jeepney route</strong>
        <p className="mt-1 inline-flex h-[22px] items-center rounded-full bg-fill px-2 text-xs font-semibold text-ink-2">Documented only · legacy</p>
      </div>
      <p className="mx-1 mt-2 text-[13px] text-ink-3">Not the same as Diversion Road. Legacy names appear only as hints.</p>
      <p className="mb-1.5 ml-1 mt-5 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Barangays</p>
      <div className="rounded-2xl bg-white px-3.5">
        <p className="flex min-h-14 items-center border-b border-navy/8 text-[17px]">Concepcion Grande</p>
        <p className="flex min-h-14 items-center text-[17px]">Concepcion Pequeña</p>
      </div>
    </div>
  );
}

export function TripPreview() {
  return (
    <div className="h-[844px] w-[390px] bg-canvas px-4 pt-14 text-navy">
      <p className="text-[34px] font-bold tracking-tight">Trip options</p>
      <div className="mt-3 rounded-2xl bg-white px-3.5 py-1 text-[17px]">
        <p className="flex min-h-11 items-center border-b border-navy/8">My location · near Plaza Rizal</p>
        <p className="flex min-h-11 items-center font-semibold">SM City Naga</p>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-[22px] bg-white p-4 shadow-[0_0_0_2px_#0B7A75]">
        <span className="text-[13px] font-bold uppercase tracking-wide text-teal-ink">Recommended</span>
        <p className="text-[28px] font-bold tracking-tight">[min] <span className="text-[15px] font-normal text-ink-2">arrive [time]</span></p>
        <span className="flex items-center gap-2 text-[13px] text-ink-2">walk · <Chip label="San Felipe" color="#2F6FE4" /> · walk</span>
        <span className="inline-flex self-start rounded-full bg-teal-soft px-2.5 py-1 text-[13px] font-semibold text-teal-ink">Exact · [₱ fare]</span>
      </div>
      <div className="mt-3 flex flex-col gap-3 rounded-[22px] bg-white p-4">
        <span className="text-[13px] font-bold uppercase tracking-wide text-ink-2">Least walking</span>
        <p className="text-[28px] font-bold tracking-tight">[min]</p>
        <span className="flex items-center gap-2"><Chip label="Del Rosario" color="#0E8C86" /> → <Chip label="Loop B" color="#3E4C6B" /></span>
      </div>
    </div>
  );
}

export function RidePreview() {
  return (
    <div className="relative h-[844px] w-[390px] overflow-hidden bg-[#F2EFE9] text-navy">
      <LeafletMap height={380} />
      <div className="absolute inset-x-0 bottom-0 top-[360px] rounded-t-[28px] bg-white px-4 pt-5">
        <p className="text-sm"><Chip label="San Felipe" color="#2F6FE4" /> toward <strong>SM City Naga</strong></p>
        <p className="mt-3 text-[22px] font-bold tracking-tight">Your stop is next</p>
        <div className="mt-4 flex items-center gap-1">
          <span className="size-3 rounded-full bg-navy" /><span className="h-1 flex-1 rounded bg-[#2F6FE4]" />
          <span className="size-4 rounded-full bg-[#2F6FE4]" /><span className="h-1 flex-1 rounded bg-fill" />
          <span className="size-4 rounded-full bg-coral" />
        </div>
        <div className="mt-6 rounded-[22px] bg-coral p-5 text-white">
          <p className="text-[34px] font-extrabold tracking-tight">Para!</p>
          <p className="mt-1 text-[15px] text-white/85">Get off at [stop name], beside the SM City Naga entrance.</p>
        </div>
      </div>
    </div>
  );
}
