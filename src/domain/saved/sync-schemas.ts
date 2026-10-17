import { z } from "zod";
import { savedPlaceSchema, savedTripSchema } from "@/domain/saved/saved";

export const syncSavedPlacesPayloadSchema = z.object({
  places: z.array(savedPlaceSchema).max(50),
});

export type SyncSavedPlacesPayloadDto = z.infer<typeof syncSavedPlacesPayloadSchema>;

export const syncSavedTripsPayloadSchema = z.object({
  trips: z.array(savedTripSchema).max(50),
});

export type SyncSavedTripsPayloadDto = z.infer<typeof syncSavedTripsPayloadSchema>;

export const savedPlacesResponseSchema = z.object({
  places: z.array(savedPlaceSchema),
});

export type SavedPlacesResponseDto = z.infer<typeof savedPlacesResponseSchema>;

export const savedTripsResponseSchema = z.object({
  trips: z.array(savedTripSchema),
});

export type SavedTripsResponseDto = z.infer<typeof savedTripsResponseSchema>;
