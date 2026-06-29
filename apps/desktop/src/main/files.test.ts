import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import os from "node:os";
import {
  mimeFor,
  isPreviewableBinary,
  looksBinary,
  isWithin,
  listDir,
  readFileAt,
  writeFileAt,
  deletePath,
  makeDir,
  uploadLocalFile,
  MAX_TEXT_BYTES,
} from "./files";
import { existsSync } from "node:fs";

// These run against the LOCAL fs branch — machine = this host's name.
const LOCAL = os.hostname();

describe("mimeFor", () => {
  it("maps known extensions", () => {
    expect(mimeFor("a.png")).toBe("image/png");
    expect(mimeFor("a.JPEG")).toBe("image/jpeg");
    expect(mimeFor("doc.pdf")).toBe("application/pdf");
    expect(mimeFor("notes.md")).toBe("application/octet-stream");
  });
});

describe("isPreviewableBinary", () => {
  it("treats images and pdf as previewable, code as not", () => {
    expect(isPreviewableBinary("x.png")).toBe(true);
    expect(isPreviewableBinary("x.pdf")).toBe(true);
    expect(isPreviewableBinary("x.ts")).toBe(false);
    expect(isPreviewableBinary("x.md")).toBe(false);
  });
});

describe("looksBinary", () => {
  it("flags NUL bytes", () => {
    expect(looksBinary(Buffer.from([104, 105, 0, 1]))).toBe(true);
  });
  it("passes plain utf8 text", () => {
    expect(looksBinary(Buffer.from("hello world\n\tindented", "utf8"))).toBe(false);
  });
  it("treats empty as text", () => {
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe("local fs operations", () => {
  it("lists dirs first then files, alphabetically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "Apps"));
    writeFileSync(join(dir, "z.txt"), "z");
    writeFileSync(join(dir, "a.txt"), "a");
    const res = await listDir({ cwd: dir, machine: LOCAL, dir });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
        "dir:Apps",
        "dir:src",
        "file:a.txt",
        "file:z.txt",
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a text file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    writeFileSync(join(dir, "hello.ts"), "export const x = 1;\n");
    const res = await readFileAt({ cwd: dir, machine: LOCAL, file: join(dir, "hello.ts") });
    expect(res).toMatchObject({ ok: true, encoding: "text", content: "export const x = 1;\n" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a png as base64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    // 1x1 transparent PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    writeFileSync(join(dir, "p.png"), png);
    const res = await readFileAt({ cwd: dir, machine: LOCAL, file: join(dir, "p.png") });
    expect(res.ok).toBe(true);
    if (res.ok && res.encoding === "base64") {
      expect(res.mime).toBe("image/png");
      expect(Buffer.from(res.content, "base64").equals(png)).toBe(true);
    } else {
      throw new Error("expected base64 png");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an oversized text file as binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    writeFileSync(join(dir, "big.txt"), "x".repeat(MAX_TEXT_BYTES + 1));
    const res = await readFileAt({ cwd: dir, machine: LOCAL, file: join(dir, "big.txt") });
    expect(res).toMatchObject({ ok: true, encoding: "binary" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a text file round-trip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    const file = join(dir, "out.md");
    const w = await writeFileAt({ cwd: dir, machine: LOCAL, file, content: "# hi\n" });
    expect(w.ok).toBe(true);
    const r = await readFileAt({ cwd: dir, machine: LOCAL, file });
    expect(r).toMatchObject({ ok: true, encoding: "text", content: "# hi\n" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("makeDir creates a folder, deletePath removes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    const mk = await makeDir({ cwd: dir, machine: LOCAL, parent: dir, name: "newdir" });
    expect(mk.ok).toBe(true);
    expect(existsSync(join(dir, "newdir"))).toBe(true);
    const del = await deletePath({ cwd: dir, machine: LOCAL, path: join(dir, "newdir") });
    expect(del.ok).toBe(true);
    expect(existsSync(join(dir, "newdir"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("deletePath recursively removes a folder with contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "f.txt"), "x");
    const del = await deletePath({ cwd: dir, machine: LOCAL, path: join(dir, "sub") });
    expect(del.ok).toBe(true);
    expect(existsSync(join(dir, "sub"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("uploadLocalFile copies a chosen file into the dest dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    const src = join(dir, "src.bin");
    writeFileSync(src, Buffer.from([1, 2, 3, 0, 255]));
    mkdirSync(join(dir, "dest"));
    const up = await uploadLocalFile({ cwd: dir, machine: LOCAL, srcPath: src, destDir: join(dir, "dest") });
    expect(up).toMatchObject({ ok: true, name: "src.bin" });
    expect(existsSync(join(dir, "dest", "src.bin"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to delete the project root or escape it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rcw-files-"));
    expect((await deletePath({ cwd: dir, machine: LOCAL, path: dir })).ok).toBe(false);
    expect((await deletePath({ cwd: dir, machine: LOCAL, path: join(dir, "..", "evil") })).ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("isWithin", () => {
  it("accepts the root and descendants, rejects siblings and ..", () => {
    expect(isWithin("/p", "/p")).toBe(true);
    expect(isWithin("/p", "/p/a/b")).toBe(true);
    expect(isWithin("/p", "/other")).toBe(false);
    expect(isWithin("/p", "/p/../x")).toBe(false);
    expect(isWithin("/p", "/people")).toBe(false); // prefix but not a child
  });
});
