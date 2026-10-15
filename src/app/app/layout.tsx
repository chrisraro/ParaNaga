import { PhoneOnlyGate } from "@/ui/app-gate/phone-only-gate";
import { AppFrame } from "@/ui/app-shell/app-frame";

// The /app section: phones only. The home map and the tab bar stay mounted in this layout; detail
// pages (/app/stops/[id], /app/routes/[code]) and tab pages (/app/explore, /app/saved, /app/more)
// render as panels over it (see src/ui/app-shell/app-frame.tsx). Static shell: no request-time
// APIs here.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <PhoneOnlyGate>
      <AppFrame>{children}</AppFrame>
    </PhoneOnlyGate>
  );
}
