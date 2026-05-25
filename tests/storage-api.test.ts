import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../runtime-node/server";

let dataDir: string;
let codexHome: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "superview-test-"));
  codexHome = mkdtempSync(path.join(tmpdir(), "superview-codex-home-"));
  cpSync(path.resolve("tests/fixtures/fake-codex-home"), codexHome, { recursive: true });
  process.env.SUPERVIEW_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.SUPERVIEW_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

describe("SuperView API", () => {
  it("reports health and starts an ingest job", async () => {
    const app = createServer();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const ingest = await request(app).post("/api/ingest").send({ codexHome });
    expect(ingest.status).toBe(202);
    expect(ingest.body.jobId).toBeTruthy();
  });

  it("skips unchanged files, paginates timelines, and returns redacted event evidence", async () => {
    const app = createServer();

    const firstJob = await runIngest(app, codexHome);
    expect(firstJob.status).toBe("completed");
    expect(firstJob.totalFiles).toBe(1);
    expect(firstJob.processedFiles).toBe(1);
    expect(firstJob.skippedFiles).toBe(0);
    expect(firstJob.totalEvents).toBeGreaterThan(0);

    const secondJob = await runIngest(app, codexHome);
    expect(secondJob.status).toBe("completed");
    expect(secondJob.totalFiles).toBe(1);
    expect(secondJob.processedFiles).toBe(1);
    expect(secondJob.skippedFiles).toBe(1);
    expect(secondJob.totalEvents).toBe(0);

    const projects = await request(app).get("/api/projects");
    expect(projects.status).toBe(200);
    expect(projects.body.projects).toHaveLength(1);
    const projectId = projects.body.projects[0].id;

    const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 2, offset: 1 });
    expect(timeline.status).toBe(200);
    expect(timeline.body.events).toHaveLength(2);
    expect(timeline.body.totalEvents).toBe(firstJob.totalEvents);
    expect(timeline.body.limit).toBe(2);
    expect(timeline.body.offset).toBe(1);
    expect(timeline.body.episodes.length).toBeGreaterThan(0);
    expect(Array.isArray(timeline.body.causalEdges)).toBe(true);
    expect(Array.isArray(timeline.body.taskJourneys)).toBe(true);

    const evidenceEvent = timeline.body.events.find((event: { rawEventRefId: string | null }) => event.rawEventRefId);
    expect(evidenceEvent).toBeTruthy();

    const evidence = await request(app).get(`/api/events/${evidenceEvent.id}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.event.id).toBe(evidenceEvent.id);
    expect(Array.isArray(evidence.body.artifacts)).toBe(true);
    expect(evidence.body.rawEvent).toMatchObject({
      id: evidenceEvent.rawEventRefId,
      type: expect.any(String),
      redactedPayload: expect.anything()
    });
    expect(evidence.body.rawEvent.redactedPayloadJson).toBeUndefined();

    const fullTimeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 50 });
    const patchedCall = fullTimeline.body.events.find((event: { callId: string; toolName: string }) => event.callId === "call-2" && event.toolName === "functions.apply_patch");
    expect(patchedCall).toMatchObject({
      status: "success",
      durationMs: expect.any(Number),
      outputEventId: expect.any(String)
    });
    expect(fullTimeline.body.causalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: patchedCall.id,
          toEventId: patchedCall.outputEventId,
          type: "same_call",
          confidence: "deterministic"
        })
      ])
    );
    expect(fullTimeline.body.taskJourneys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promptEventId: expect.any(String),
          title: expect.any(String),
          eventIds: expect.any(Array),
          stages: expect.any(Array)
        })
      ])
    );
  });

  it("adds git commits to the project timeline when sessions belong to a git repo", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "superview-api-git-"));
    const gitCodexHome = mkdtempSync(path.join(tmpdir(), "superview-git-codex-home-"));
    try {
      git(repoRoot, ["init"]);
      writeFileSync(path.join(repoRoot, "README.md"), "hello\n");
      git(repoRoot, ["add", "README.md"]);
      git(repoRoot, ["commit", "-m", "initial project commit"]);
      mkdirSync(path.join(gitCodexHome, "sessions", "2026", "05", "25"), { recursive: true });
      writeFileSync(
        path.join(gitCodexHome, "sessions", "2026", "05", "25", "rollout-git.jsonl"),
        [
          JSON.stringify({ timestamp: "2026-05-25T01:00:00.000Z", type: "session_meta", payload: { id: "git-session", timestamp: "2026-05-25T01:00:00.000Z", cwd: repoRoot, cli_version: "0.125.0", model_provider: "OpenAI", source: "cli" } }),
          JSON.stringify({ timestamp: "2026-05-25T01:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "show git timeline" }] } }),
          JSON.stringify({ timestamp: "2026-05-25T01:00:05.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "git timeline captured" }] } })
        ].join("\n")
      );

      const app = createServer();
      const job = await runIngest(app, gitCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const projectId = projects.body.projects.find((project: { name: string }) => project.name === path.basename(repoRoot)).id;
      const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 20 });
      expect(timeline.body.events.some((event: { toolName: string; title: string; commitHash: string | null }) => event.toolName === "git" && event.title.includes("initial project commit") && event.commitHash)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(gitCodexHome, { recursive: true, force: true });
    }
  });
});

async function runIngest(app: express.Express, sourceCodexHome: string) {
  const ingest = await request(app).post("/api/ingest").send({ codexHome: sourceCodexHome });
  expect(ingest.status).toBe(202);
  return waitForJob(app, ingest.body.jobId);
}

function git(repoRoot: string, args: string[]) {
  execFileSync("git", ["-C", repoRoot, ...args], {
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Test Committer",
      GIT_COMMITTER_EMAIL: "committer@example.com",
      GIT_AUTHOR_DATE: "2026-05-25T01:00:02Z",
      GIT_COMMITTER_DATE: "2026-05-25T01:00:02Z"
    }
  });
}

async function waitForJob(app: express.Express, jobId: string) {
  for (let index = 0; index < 50; index += 1) {
    const response = await request(app).get(`/api/ingest/jobs/${jobId}`);
    expect(response.status).toBe(200);
    if (response.body.status === "completed" || response.body.status === "failed") {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ingest job ${jobId}`);
}
