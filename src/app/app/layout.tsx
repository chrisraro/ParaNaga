import { PhoneOnlyGate } from "@/ui/app-gate/phone-only-gate";
import { AppFrame } from "@/ui/app-shell/app-frame";

// The /app section: phones only. The home map stays mounted in this layout; /app/stops/[id] and
// /app/routes/[code] render as panels over it (see src/ui/app-shell/app-frame.tsx). Static shell:
// no request-time APIs here.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <PhoneOnlyGate>
      <AppFrame>{children}</AppFrame>
    </PhoneOnlyGate>
  );
}
