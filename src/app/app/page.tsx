import type { Metadata } from "next";
import { PhoneOnlyGate } from "@/ui/app-gate/phone-only-gate";
import { HomeScreen } from "@/ui/home/home-screen";

export const metadata: Metadata = {
  title: "App",
  description: "Plan commutes around Naga City: set your start and destination on the map.",
};

// Static shell: no request-time APIs here; HomeScreen is a Client Component.
export default function AppPage() {
  return (
    <PhoneOnlyGate>
      <HomeScreen />
    </PhoneOnlyGate>
  );
}
