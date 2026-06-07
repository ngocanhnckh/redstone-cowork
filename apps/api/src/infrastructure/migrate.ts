import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./db";

export async function migrate(databaseUrl: string, dir = join(__dirname, "../../migrations")) {
  const pool = createPool(databaseUrl);
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const applied = new Set((await pool.query("SELECT name FROM _migrations")).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await pool.query("BEGIN");
    try {
      await pool.query(readFileSync(join(dir, file), "utf8"));
      await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
  await pool.end();
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  migrate(url).then(() => process.exit(0));
}
