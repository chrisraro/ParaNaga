// The three hub topics (S17, F-D2). The value is stored; the label is what commuters read.

export const COMMUNITY_TOPICS = [
  { value: "commute_tips", label: "Commute tips", hint: "What worked for you on a ride" },
  { value: "first_time", label: "First-time questions", hint: "Asking how something works in Naga" },
  { value: "route_stop_feedback", label: "Route/stop feedback", hint: "What you noticed at a stop or on a route" },
] as const;

export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number]["value"];
export const TOPIC_VALUES = COMMUNITY_TOPICS.map((t) => t.value) as [CommunityTopic, ...CommunityTopic[]];

export function isTopic(value: unknown): value is CommunityTopic {
  return typeof value === "string" && (TOPIC_VALUES as readonly string[]).includes(value);
}

export function topicLabel(value: CommunityTopic): string {
  return COMMUNITY_TOPICS.find((t) => t.value === value)?.label ?? value;
}
