import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCodexJsonlContent } from "../core/parser";
import { redactString } from "../core/redactor";
import { normalizeCodexLines } from "../core/normalizer";
import { buildProjectTimeline } from "../core/timeline";
import { buildReplayNodes } from "../core/replay";

function fixture(name: string) {
  return readFileSync(`tests/fixtures/codex-rollouts/${name}`, "utf8");
}

describe("Codex parser and normalizer", () => {
  it("parses session_meta, turn_context, response_item, and event_msg records", () => {
    const lines = parseCodexJsonlContent(fixture("failed-test-rollout.jsonl"), "failed-test-rollout.jsonl");
    expect(lines.map((line) => line.type)).toContain("session_meta");
    expect(lines.map((line) => line.type)).toContain("response_item");
    expect(lines.map((line) => line.type)).toContain("event_msg");
  });

  it("normalizes tool calls, patches, and tool outputs", () => {
    const lines = parseCodexJsonlContent(fixture("tool-call-rollout.jsonl"), "tool-call-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();
    expect(bundle?.events.some((event) => event.kind === "verification")).toBe(true);
    expect(bundle?.events.some((event) => event.kind === "file_change")).toBe(true);
    const patchCall = bundle?.events.find((event) => event.callId === "call-2" && event.toolName === "functions.apply_patch");
    expect(patchCall?.outputEventId).toBeTruthy();
    expect(bundle?.events.some((event) => event.id === patchCall?.outputEventId)).toBe(true);
  });

  it("redacts obvious secrets before display or storage", () => {
    const redacted = redactString("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\nAuthorization: Bearer very-secret-token\nRESEND_API_KEY=re_1234567890abcdef");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("very-secret-token");
    expect(redacted).not.toContain("1234567890abcdef");
    expect(redacted).toContain("[REDACTED]");
  });

  it("builds timeline episodes and replay nodes from fixture events", () => {
    const lines = parseCodexJsonlContent(fixture("failed-test-rollout.jsonl"), "failed-test-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    expect(timeline.episodes.length).toBeGreaterThan(0);
    expect(timeline.events.some((event) => event.lane === "Risks")).toBe(true);

    const nodes = buildReplayNodes(bundle!.events);
    expect(nodes.some((node) => node.type === "hazard")).toBe(true);
  });

  it("builds task journeys from each user prompt boundary", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    const prompt = timeline.events.find((event) => event.kind === "user_prompt");
    const retryMessage = timeline.events.find((event) => event.title.includes("Retrying"));
    const journey = timeline.taskJourneys[0];

    expect(timeline.taskJourneys).toHaveLength(1);
    expect(journey).toMatchObject({
      projectId: bundle!.project.id,
      sessionId: "fixture-call-association-session",
      promptEventId: prompt?.id,
      title: "Update architecture docs and retry failing tests",
      startedAt: prompt?.timestamp,
      endedAt: retryMessage?.timestamp,
      status: "failed",
      exitType: "session_end"
    });
    expect(journey.eventIds[0]).toBe(prompt?.id);
    expect(journey.eventIds).toContain(retryMessage?.id);
    expect(journey.stageCounts).toMatchObject({
      Product: 1,
      Architecture: 2,
      Verification: 1,
      Risks: 1,
      "Agent Runs": 1
    });
    expect(journey.stages.map((stage) => stage.lane)).toEqual(["Product", "Architecture", "Agent Runs", "Verification", "Risks"]);
  });

  it("builds causal edges between prompts, patches, failed tests, and retries", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    const { causalEdges } = timeline;
    const docCall = timeline.events.find((event) => event.callId === "call-docs" && event.title === "Patched files");
    const docOutput = timeline.events.find((event) => event.id === docCall?.outputEventId);
    const testCall = timeline.events.find((event) => event.callId === "call-test" && event.toolName === "functions.exec_command");
    const testOutput = timeline.events.find((event) => event.id === testCall?.outputEventId);
    const retryMessage = timeline.events.find((event) => event.title.includes("Retrying"));

    expect(causalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: docCall?.id,
          toEventId: docOutput?.id,
          type: "same_call",
          confidence: "deterministic"
        }),
        expect.objectContaining({
          toEventId: docCall?.id,
          type: "updates_design"
        }),
        expect.objectContaining({
          fromEventId: testCall?.id,
          toEventId: testOutput?.id,
          type: "failed_by"
        }),
        expect.objectContaining({
          fromEventId: testOutput?.id,
          toEventId: retryMessage?.id,
          type: "retried_by"
        })
      ])
    );
    expect(causalEdges.every((edge) => edge.reason.length > 0)).toBe(true);
  });

  it("associates function call outputs with calls and derives lanes for docs, failures, and retries", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const docCall = bundle!.events.find((event) => event.callId === "call-docs" && event.title === "Patched files");
    expect(docCall).toBeTruthy();
    expect(docCall?.status).toBe("success");
    expect(docCall?.lane).toBe("Architecture");
    expect(docCall?.durationMs).toBe(3000);
    expect(docCall?.outputEventId).toBeTruthy();

    const docOutput = bundle!.events.find((event) => event.id === docCall?.outputEventId);
    expect(docOutput?.kind).toBe("file_change");
    expect(docOutput?.lane).toBe("Architecture");
    expect(docOutput?.status).toBe("success");

    const testCall = bundle!.events.find((event) => event.callId === "call-test" && event.toolName === "functions.exec_command");
    expect(testCall?.status).toBe("failed");
    expect(testCall?.durationMs).toBe(3000);
    expect(testCall?.outputEventId).toBeTruthy();

    const testOutput = bundle!.events.find((event) => event.id === testCall?.outputEventId);
    expect(testOutput?.kind).toBe("error");
    expect(testOutput?.lane).toBe("Risks");
    expect(testOutput?.status).toBe("failed");

    const nodes = buildReplayNodes(bundle!.events);
    expect(nodes.some((node) => node.eventId === testCall?.id && node.type === "hazard")).toBe(true);
    expect(nodes.some((node) => node.type === "loop" && node.label === "Retry")).toBe(true);
  });
});
