import { z } from "zod";

/**
 * A public key registration for the NAT'd-host SSH relay. `kind` distinguishes an
 * agent's reverse-tunnel key (binds exactly one relay loopback port) from a
 * cockpit's jump key (loopback-only `-W` egress on the relay).
 */
export const TunnelProvisionRequestSchema = z.object({
  pubkey: z.string().min(1),
  kind: z.enum(["agent", "cockpit"]),
});
export type TunnelProvisionRequest = z.infer<typeof TunnelProvisionRequestSchema>;

/**
 * How to reach a host's reverse tunnel through the relay: SSH to `relayHost:relayPort`
 * as `tunnelUser` and jump to the relay loopback port `tunnelPort`.
 */
export const TunnelCoordinatesSchema = z.object({
  relayHost: z.string(),
  relayPort: z.coerce.number(),
  tunnelUser: z.string(),
  tunnelPort: z.coerce.number(),
});
export type TunnelCoordinates = z.infer<typeof TunnelCoordinatesSchema>;
