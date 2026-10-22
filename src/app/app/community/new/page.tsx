import type { Metadata } from "next";
import { LocalizedPageFrame } from "@/ui/app-shell/localized-page-frame";
import { PostComposer } from "@/ui/community/post-composer";

export const metadata: Metadata = {
  title: "New post",
  description: "Share a commuting tip or ask a question about getting around Naga.",
};

export default function NewPostPage() {
  return (
    <LocalizedPageFrame title="communityNew" back testId="community-new-page">
      <PostComposer mode="new" />
    </LocalizedPageFrame>
  );
}
