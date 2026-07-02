import { Injectable } from "@nestjs/common";
import { HostTelemetrySchema, DockerReportSchema, CapsReportSchema, type HostTelemetry, type DockerContainer, type CapItem } from "@rcw/shared";

type Entry = {
  latest: HostTelemetry;
  at: Date;
  cpuHistory: number[];
  netRxHistory: number[];
  netTxHistory: number[];
};

type DockerEntry = { available: boolean; containers: DockerContainer[]; at: Date };
type CapsEntry = { skills: CapItem[]; commands: CapItem[]; at: Date };

const HISTORY = 30; // samples kept per host for sparklines

/**
 * Live host telemetry for the HUD. Ephemeral by design — kept in an in-memory ring
 * buffer per host (last 30 samples). Not persisted: it's a real-time view, and a
 * fresh agent repopulates it within seconds of a restart.
 */
@Injectable()
export class TelemetryService {
  private readonly byHost = new Map<string, Entry>();
  private readonly dockerByHost = new Map<string, DockerEntry>();
  private readonly capsByHost = new Map<string, CapsEntry>();

  record(hostId: string, input: unknown): void {
    const t = HostTelemetrySchema.parse(input);
    const now = new Date();
    const prev = this.byHost.get(hostId);
    const push = (arr: number[] | undefined, v: number) => [...(arr ?? []), v].slice(-HISTORY);
    this.byHost.set(hostId, {
      latest: t,
      at: now,
      cpuHistory: push(prev?.cpuHistory, t.cpuPct),
      netRxHistory: push(prev?.netRxHistory, t.netRxBps ?? 0),
      netTxHistory: push(prev?.netTxHistory, t.netTxBps ?? 0),
    });
  }

  /** Latest + history per host, keyed by hostId (machine is joined by the caller). */
  all(): Map<string, Entry> {
    return this.byHost;
  }

  recordDocker(hostId: string, input: unknown): void {
    const { available, containers } = DockerReportSchema.parse(input);
    this.dockerByHost.set(hostId, { available, containers, at: new Date() });
  }

  allDocker(): Map<string, DockerEntry> {
    return this.dockerByHost;
  }

  recordCaps(hostId: string, input: unknown): void {
    const { skills, commands } = CapsReportSchema.parse(input);
    this.capsByHost.set(hostId, { skills, commands, at: new Date() });
  }

  allCaps(): Map<string, CapsEntry> {
    return this.capsByHost;
  }
}
