import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EventsBus } from "../src/application/events-bus";

const auth = { Authorization: "Bearer test-token" };

describe("GET /stream (SSE)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_TOKEN = "test-token";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await app.listen(0);
  });
  afterAll(() => app.close());

  it("401s without token", async () => {
    await request(app.getHttpServer()).get("/stream").expect(401);
  });

  it("streams decision.created events", async () => {
    const url = await app.getUrl();
    const res = await fetch(`${url}/stream`, { headers: { Authorization: "Bearer test-token" } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    app.get(EventsBus).emit({ type: "decision.created", payload: { id: "x" } });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("decision.created");
    await reader.cancel();
  });
});
