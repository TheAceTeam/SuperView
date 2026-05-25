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
    expect(bundle?.events.some((event) => event.kind === "tool_result")).toBe(true);
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
});
