import { Pool } from "pg";

export const createPool = (databaseUrl: string) => new Pool({ connectionString: databaseUrl });
