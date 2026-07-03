import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import type { TunnelCoordinates } from "@rcw/shared";
import { TunnelService } from "../../application/tunnel.service";
import { ExternalApiGuard } from "./external-api.guard";

const AgentProvisionSchema = z.object({ pubkey: z.string().min(1) });
const CockpitKeySchema = z.object({ pubkey: z.string().min(1), label: z.string().min(1) });

/**
 * NAT'd-host SSH relay surface. Agents provision a reverse tunnel; cockpit clients
 * fetch coordinates + register their jump key. Shares the ExternalApiGuard so
 * device/instance/access-key/redstone tokens all work (same as the host surface).
 */
@Controller()
@UseGuards(ExternalApiGuard)
export class TunnelController {
  constructor(private readonly tunnel: TunnelService) {}

  /** Agent provisions/refreshes its reverse tunnel; returns full relay coordinates. */
  @Post("hosts/:id/tunnel")
  @HttpCode(200)
  async provision(@Param("id") id: string, @Body() body: unknown): Promise<TunnelCoordinates> {
    try {
      const { pubkey } = AgentProvisionSchema.parse(body);
      return await this.tunnel.provisionAgent(id, pubkey);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  /** Cockpit fetches a provisioned host's relay coordinates (404 if not provisioned). */
  @Get("hosts/:id/tunnel")
  async coordinates(@Param("id") id: string): Promise<TunnelCoordinates> {
    const coords = await this.tunnel.getCoordinates(id);
    if (!coords) throw new NotFoundException();
    return coords;
  }

  /** Cockpit registers its jump key for loopback-only egress on the relay. */
  @Post("tunnel/cockpit-key")
  @HttpCode(200)
  async cockpitKey(@Body() body: unknown) {
    try {
      const { pubkey, label } = CockpitKeySchema.parse(body);
      return await this.tunnel.registerCockpitKey(label, pubkey);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
