import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseUuidParam } from "@/domain/api/schemas";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { PostThread } from "@/ui/community/post-thread";

export const metadata: Metadata = {
  title: "Community post",
  description: "A post from a Naga commuter and its comments. Not verified by ParaNaga.",
};

// Cache Components: the id is runtime data, so it is read inside Suspense; the frame is prerendered.
export default function CommunityPostPage({ params }: PageProps<"/app/community/[id]">) {
  return (
    <PageFrame title="Post" back testId="community-post-page">
      <Suspense fallback={null}>
        <ThreadFromParams params={params} />
      </Suspense>
    </PageFrame>
  );
}

async function ThreadFromParams({ params }: { params: PageProps<"/app/community/[id]">["params"] }) {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) notFound();
  return <PostThread id={id.value} />;
}
