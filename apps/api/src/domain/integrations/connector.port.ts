import type { ConnectorKind, IngestedEvent } from "@rcw/shared";

/** Resolved config a connector needs to talk to its platform. */
export type ConnectorConfig = {
  endpoint: string;
  token: string;
  config: Record<string, unknown>;
};

export type PullResult = {
  events: IngestedEvent[];
  /** Opaque per-connector sync state, persisted and handed back on the next pull. */
  cursor: Record<string, unknown>;
};

/** FR-1 — every connector implements this. writeBack/subscribe come in later slices. */
export interface Connector {
  readonly kind: ConnectorKind;
  validate(cfg: ConnectorConfig): Promise<{ ok: boolean; error?: string }>;
  pull(cfg: ConnectorConfig, cursor: Record<string, unknown>): Promise<PullResult>;
}
export const CONNECTORS = Symbol("Connectors"); // injected as Connector[]
