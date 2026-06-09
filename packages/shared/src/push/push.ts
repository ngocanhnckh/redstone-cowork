import { z } from "zod";

// The browser's PushSubscription serialized to JSON, plus an optional device label.
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  label: z.string().optional(),
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
