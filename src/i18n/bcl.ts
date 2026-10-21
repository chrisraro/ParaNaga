// Central Bikol, Naga City usage (ADR 011). Partial while drafting: a missing key falls back to
// Filipino, then English. Hidden until BIKOL_ENABLED, which needs every key native-approved.
import type { DeepPartial, Dict } from "./dict";

export const bcl: DeepPartial<Dict> = {};
