import type { Metadata } from "next";
import { MyNagaScreen } from "@/ui/mynaga/mynaga-screen";

export const metadata: Metadata = {
  title: "Report in MyNaga",
  description: "How to report a problem with a driver to the City of Naga in its MyNaga app. ParaNaga is not affiliated with MyNaga.",
};

// Informational handoff (decision D9): nothing is prepared, copied, sent or recorded here.
export default function MyNagaPage() {
  return <MyNagaScreen />;
}
