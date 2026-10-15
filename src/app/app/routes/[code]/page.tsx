import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseRouteCodeParam } from "@/domain/api/schemas";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { RouteDetailScreen } from "@/ui/routes/route-detail";

export const metadata: Metadata = {
  title: "Route",
  description: "A Naga City jeepney route from the approved plan: street order, sources and what is not yet verified.",
};

// See src/app/app/stops/[id]/page.tsx: the code is runtime data, read inside Suspense.
export default function RoutePage({ params }: PageProps<"/app/routes/[code]">) {
  return (
    <Suspense fallback={<DetailLoading title="Route" />}>
      <RouteFromParams params={params} />
    </Suspense>
  );
}

async function RouteFromParams({ params }: { params: PageProps<"/app/routes/[code]">["params"] }) {
  const code = parseRouteCodeParam((await params).code);
  if (!code.ok) notFound();
  return <RouteDetailScreen code={code.value} />;
}
