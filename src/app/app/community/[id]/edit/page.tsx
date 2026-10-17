import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseUuidParam } from "@/domain/api/schemas";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { PostComposer } from "@/ui/community/post-composer";

export const metadata: Metadata = {
  title: "Edit post",
  description: "Edit your community post. The edit is checked before it replaces the current version.",
};

export default function EditPostPage({ params }: PageProps<"/app/community/[id]/edit">) {
  return (
    <PageFrame title="Edit post" back testId="community-edit-page">
      <Suspense fallback={null}>
        <ComposerFromParams params={params} />
      </Suspense>
    </PageFrame>
  );
}

async function ComposerFromParams({ params }: { params: PageProps<"/app/community/[id]/edit">["params"] }) {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) notFound();
  return <PostComposer mode="edit" postId={id.value} />;
}
