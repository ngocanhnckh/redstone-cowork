import { Controller, Get, UseGuards } from "@nestjs/common";
import type { HostTelemetryView, DockerHostView, CapsHostView } from "@rcw/shared";
import { TelemetryService } from "../../application/telemetry.service";
import { InventoryService } from "../../application/inventory.service";
import { InstanceTokenGuard } from "./instance-token.guard";

/**
 * Live host telemetry for the HUD. Joins the ephemeral telemetry ring buffers with
 * the host registry so each entry carries a human machine name.
 */
@Controller("telemetry")
@UseGuards(InstanceTokenGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly inventory: InventoryService,
  ) {}

  @Get()
  async list(): Promise<HostTelemetryView[]> {
    const hosts = await this.inventory.listHosts();
    const machineOf = new Map(hosts.map((h) => [h.id, h.machine]));
    const out: HostTelemetryView[] = [];
    for (const [hostId, e] of this.telemetry.all()) {
      out.push({
        hostId,
        machine: machineOf.get(hostId) ?? hostId,
        at: e.at.toISOString(),
        latest: e.latest,
        cpuHistory: e.cpuHistory,
        netRxHistory: e.netRxHistory,
        netTxHistory: e.netTxHistory,
      });
    }
    return out;
  }

  @Get("docker")
  async docker(): Promise<DockerHostView[]> {
    const hosts = await this.inventory.listHosts();
    const machineOf = new Map(hosts.map((h) => [h.id, h.machine]));
    const out: DockerHostView[] = [];
    for (const [hostId, e] of this.telemetry.allDocker()) {
      out.push({ hostId, machine: machineOf.get(hostId) ?? hostId, at: e.at.toISOString(), available: e.available, containers: e.containers });
    }
    return out;
  }

  @Get("caps")
  async caps(): Promise<CapsHostView[]> {
    const hosts = await this.inventory.listHosts();
    const machineOf = new Map(hosts.map((h) => [h.id, h.machine]));
    const out: CapsHostView[] = [];
    for (const [hostId, e] of this.telemetry.allCaps()) {
      out.push({ hostId, machine: machineOf.get(hostId) ?? hostId, at: e.at.toISOString(), skills: e.skills, commands: e.commands });
    }
    return out;
  }
}
