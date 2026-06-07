import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Pool } from "pg";
import { createPool } from "./db";
import { loadConfig } from "./config";

export const PG_POOL = Symbol("PgPool");

/** Factory for the PG_POOL provider — produces the shared Pool or null when DATABASE_URL is unset. */
export const pgPoolProvider = {
  provide: PG_POOL,
  useFactory: (): Pool | null => {
    const { DATABASE_URL } = loadConfig();
    return DATABASE_URL ? createPool(DATABASE_URL) : null;
  },
};

/**
 * Holds a reference to the shared pg Pool and ends it on module destroy,
 * clearing the P1 tech-debt item (pool leaked on shutdown).
 */
@Injectable()
export class PoolShutdown implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
