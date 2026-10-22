// The three hub topics (S17, F-D2). The value is stored; the label is what commuters read
// (community.topics in the dictionary; English here, `topicsIn(copy)` for the UI language).
import { en, type Dict } from "@/i18n/dict";

const VALUES = ["commute_tips", "first_time", "route_stop_feedback"] as const;

export const topicsIn = (copy: Dict["community"] = en.community) => VALUES.map((value) => ({ value, ...copy.topics[value] }));

export const COMMUNITY_TOPICS = topicsIn();

export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number]["value"];
export const TOPIC_VALUES = COMMUNITY_TOPICS.map((t) => t.value) as [CommunityTopic, ...CommunityTopic[]];

export function isTopic(value: unknown): value is CommunityTopic {
  return typeof value === "string" && (TOPIC_VALUES as readonly string[]).includes(value);
}

export function topicLabel(value: CommunityTopic, copy: Dict["community"] = en.community): string {
  return copy.topics[value]?.label ?? value;
}
