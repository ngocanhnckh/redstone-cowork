import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PROBE_SOURCE_B64, PROBE_SHA, PROBE_BYTES } from "./probe-source.generated";

const PY_PATH = join(__dirname, "..", "..", "..", "resources", "probe", "rcw_probe.py");

describe("embedded probe source", () => {
  const py = readFileSync(PY_PATH, "utf8");

  // The generated file is committed so `pnpm dev` needs no prebuild step — which
  // means it can silently drift when someone edits the .py. This is the tripwire.
  it("is in sync with resources/probe/rcw_probe.py", () => {
    const sha = createHash("sha256").update(py, "utf8").digest("hex").slice(0, 16);
    expect(sha, "run `pnpm --filter @rcw/desktop probe:embed` after editing rcw_probe.py").toBe(PROBE_SHA);
    expect(Buffer.byteLength(py, "utf8")).toBe(PROBE_BYTES);
  });

  it("decodes back to the exact Python source", () => {
    expect(Buffer.from(PROBE_SOURCE_B64, "base64").toString("utf8")).toBe(py);
  });

  it("is a single base64 line — python's readline() must get the whole program", () => {
    expect(PROBE_SOURCE_B64).not.toContain("\n");
    expect(PROBE_SOURCE_B64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("uses only the standard library, so no host needs pip", () => {
    // Strip docstrings and comments first — prose like "…writes / from worker threads…"
    // looks exactly like an import statement to a naive line regex.
    const code = py.replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");
    const imports = [...code.matchAll(/^[ \t]*(?:import|from)\s+([A-Za-z_][\w.]*)/gm)].map((m) => m[1].split(".")[0]);
    const stdlib = new Set([
      "base64", "json", "os", "subprocess", "sys", "threading", "time", "zlib",
      "queue", "Queue", "pwd", "__future__",
    ]);
    const foreign = [...new Set(imports)].filter((m) => !stdlib.has(m));
    expect(foreign, `non-stdlib imports would break hosts without pip: ${foreign.join(", ")}`).toEqual([]);
  });

  it("avoids syntax the oldest supported python (3.6) can't parse", () => {
    // No walrus (3.8+), no dataclasses (3.7+). A SyntaxError here is invisible until
    // it fails on someone's older box, so keep it a test rather than a convention.
    // Match actual usage, not the words in this file's own docstring.
    expect(py).not.toMatch(/[^:=!<>]:=[^=]/);
    expect(py).not.toMatch(/^\s*@dataclass/m);
    expect(py).not.toMatch(/capture_output\s*=/);
  });
});
