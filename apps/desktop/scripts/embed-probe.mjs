#!/usr/bin/env node
// Generate src/main/direct/probe-source.generated.ts from resources/probe/rcw_probe.py.
//
// The probe is pushed to the remote over a pipe and never written to its disk, so it
// has to be a string in the main bundle. Embedding (rather than shipping it via
// electron-builder `extraResources`, the way geoip.ts does) also removes a whole bug
// class: no packaged-vs-dev path resolution, and no way for the file to be missing at
// runtime.
//
// The generated file is COMMITTED so `pnpm dev` works without a prebuild step;
// probe-source.test.ts fails if the .py is edited without re-running this.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcPath = join(root, "resources", "probe", "rcw_probe.py");
const outPath = join(root, "src", "main", "direct", "probe-source.generated.ts");

const py = readFileSync(srcPath, "utf8");
const b64 = Buffer.from(py, "utf8").toString("base64");
const sha = createHash("sha256").update(py, "utf8").digest("hex").slice(0, 16);

// Wrap so the generated line isn't one unreadable 30 KB blob in diffs/editors.
const wrapped = (b64.match(/.{1,120}/g) ?? []).map((l) => `  "${l}",`).join("\n");

const out = `// GENERATED FILE — do not edit.
// Source: apps/desktop/resources/probe/rcw_probe.py
// Regenerate: pnpm --filter @rcw/desktop probe:embed
//
// The remote probe program, base64'd for delivery over the SSH channel's stdin.

/** sha256 (first 16 hex chars) of the Python source this was generated from. */
export const PROBE_SHA = ${JSON.stringify(sha)};

/** Uncompressed size of the Python source, in bytes. */
export const PROBE_BYTES = ${Buffer.byteLength(py, "utf8")};

const PARTS = [
${wrapped}
];

/** The probe program, base64-encoded. Sent as ONE line on the channel's stdin. */
export const PROBE_SOURCE_B64 = PARTS.join("");
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out, "utf8");
console.log(`embed-probe: ${Buffer.byteLength(py, "utf8")} bytes → ${outPath} (sha ${sha})`);
