// The Home chip row: saved places first (a tap sets one as the destination), then the place
// categories, each a link to Explore filtered to that category. Pure, so the order is testable.

import { EXPLORE_CATEGORIES, type ExploreCategoryId } from "@/domain/places/explore";
import type { SavedPlace } from "@/domain/saved/saved";

/** Category chips shown on Home, in order. Route and terminal layers stay in the Layers button. */
export const HOME_CATEGORY_IDS: readonly ExploreCategoryId[] = ["food", "schools", "health", "markets", "government", "terminals"];
/** More saved places than this are reached through Search and Saved. */
export const MAX_SAVED_CHIPS = 4;

export type HomeChip =
  | { kind: "saved"; id: string; label: string; place: Pick<SavedPlace, "id" | "label" | "point" | "source"> }
  | { kind: "category"; id: ExploreCategoryId; label: string; href: string };

export function homeChips(saved: readonly Pick<SavedPlace, "id" | "label" | "point" | "source">[]): HomeChip[] {
  const savedChips = saved.slice(0, MAX_SAVED_CHIPS).map((place): HomeChip => ({ kind: "saved", id: place.id, label: place.label, place }));
  const categories = HOME_CATEGORY_IDS.flatMap((id): HomeChip[] => {
    const category = EXPLORE_CATEGORIES.find((c) => c.id === id);
    return category ? [{ kind: "category", id, label: category.label, href: `/app/explore?c=${id}` }] : [];
  });
  return [...savedChips, ...categories];
}
