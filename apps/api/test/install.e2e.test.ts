import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";

describe("install endpoints (no auth)", () => {
  let app: INestApplication;
  let bundleTmp: string;

  beforeAll(async () => {
    bundleTmp = join(tmpdir(), `test-bundle-${Date.now()}.js`);
    writeFileSync(bundleTmp, "console.log('hello-bundle')");
    process.env.REDSTONE_BUNDLE_PATH = bundleTmp;

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.REDSTONE_BUNDLE_PATH;
  });

  it("GET /install.sh returns 200 text/plain with expected content", async () => {
    const res = await request(app.getHttpServer()).get("/install.sh").expect(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("redstone init");
    expect(res.text).toContain("/install/redstone.js");
  });

  it("GET /install/redstone.js returns 200 application/javascript with bundle content", async () => {
    const res = await request(app.getHttpServer()).get("/install/redstone.js").expect(200);
    expect(res.headers["content-type"]).toContain("application/javascript");
    expect(res.text).toContain("hello-bundle");
  });
});
