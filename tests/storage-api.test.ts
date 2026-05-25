import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../runtime-node/server";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "superview-test-"));
  process.env.SUPERVIEW_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.SUPERVIEW_DATA_DIR;
});

describe("SuperView API", () => {
  it("reports health and starts an ingest job", async () => {
    const app = createServer();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const ingest = await request(app).post("/api/ingest").send({ codexHome: "tests/fixtures/fake-codex-home" });
    expect(ingest.status).toBe(202);
    expect(ingest.body.jobId).toBeTruthy();
  });
});
