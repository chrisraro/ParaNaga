import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { PostComposer } from "@/ui/community/post-composer";

export const metadata: Metadata = {
  title: "New post",
  description: "Share a commuting tip or ask a question about getting around Naga.",
};

export default function NewPostPage() {
  return (
    <PageFrame title="New post" back testId="community-new-page">
      <PostComposer mode="new" />
    </PageFrame>
  );
}
