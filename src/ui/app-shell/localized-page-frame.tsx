"use client";

// A PageFrame whose title follows the UI language, for server pages (which cannot read it). The
// page names the title it wants; children may be server components.
import type { ComponentProps } from "react";
import type { Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { PageFrame } from "./page-frame";

const titles = (t: Dict) => ({
  help: t.help.title,
  report: t.report.title,
  reportDriver: t.driverReport.title,
  reports: t.reports.title,
  reportDetail: t.reports.detailTitle,
  community: t.community.title,
  communityPost: t.community.postTitle,
  communityNew: t.community.newTitle,
  communityEdit: t.community.editTitle,
  signIn: t.auth.title,
});

export type FrameTitle = keyof ReturnType<typeof titles>;

export function LocalizedPageFrame({ title, ...props }: Omit<ComponentProps<typeof PageFrame>, "title"> & { title: FrameTitle }) {
  return <PageFrame title={titles(useT())[title]} {...props} />;
}
