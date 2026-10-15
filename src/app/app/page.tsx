import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "App",
  description: "Plan commutes around Naga City: set your start and destination on the map.",
};

// The home screen itself lives in the /app layout (it stays mounted under the stop and route
// panels); this page adds nothing over it.
export default function AppPage() {
  return null;
}
