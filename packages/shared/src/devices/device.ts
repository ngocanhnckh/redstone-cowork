import { z } from "zod";

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  createdAt: z.coerce.date(),
  lastSeenAt: z.coerce.date().nullable().default(null),
  revokedAt: z.coerce.date().nullable().default(null),
});
export type Device = z.infer<typeof DeviceSchema>;

export const NewDeviceSchema = z.object({ label: z.string().min(1).max(60) });
export type NewDevice = z.infer<typeof NewDeviceSchema>;

export const MintedDeviceSchema = DeviceSchema.extend({ token: z.string().min(1) });
export type MintedDevice = z.infer<typeof MintedDeviceSchema>;
