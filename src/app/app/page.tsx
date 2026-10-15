import type { Metadata } from "next";
import { AppPreviewShell } from "@/ui/app-gate/app-preview-shell";
import { PhoneOnlyGate } from "@/ui/app-gate/phone-only-gate";

export const metadata: Metadata = {
  title: "App",
  description: "Open ParaNaga on your phone to plan commutes around Naga City.",
};

export default function AppPage() {
  return (
    <PhoneOnlyGate>
      <AppPreviewShell />
    </PhoneOnlyGate>
  );
}
