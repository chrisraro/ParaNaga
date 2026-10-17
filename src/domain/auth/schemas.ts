import { z } from "zod";
import { ROLES } from "@/domain/auth/permissions";

export const roleSchema = z.enum(ROLES);

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  roles: z.array(roleSchema),
});

export type AuthUserDto = z.infer<typeof authUserSchema>;

export const authSessionResponseSchema = z.object({
  user: authUserSchema.nullable(),
});

export type AuthSessionResponseDto = z.infer<typeof authSessionResponseSchema>;
