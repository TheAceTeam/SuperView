import { mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../runtime-node/adapters/claude-code";
import { codexAdapter } from "../runtime-node/adapters/codex";
import { opencodeAdapter } from "../runtime-node/adapters/opencode";

describe("agent log adapters", () => {
  it("normalizes Claude Code JSONL into the shared task journey model", async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), "superview-claude-home-"));
    try {
      const projectDir = path.join(sourceRoot, "projects", "-tmp-superview-multi-agent");
      mkdirSync(projectDir, { recursive: true });
      cpSync(path.resolve("tests/fixtures/claude-code-transcripts/sample-session.jsonl"), path.join(projectDir, "sample-session.jsonl"));

      const sources = await claudeCodeAdapter.scan({ provider: "claude-code", root: sourceRoot });
      expect(sources).toHaveLength(1);

      const bundle = requireBundle(await claudeCodeAdapter.parseSource(sources[0], { repoRoot: "/tmp/superview-multi-agent" }));
      expect(bundle.session).toMatchObject({
        id: "claude-code:claude-session-1",
        provider: "claude-code",
        externalSessionId: "claude-session-1",
        cliVersion: "1.2.3",
        modelProvider: "Anthropic"
      });
      expect(bundle.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "user_prompt", detail: "Review the checkout flow" }),
          expect.objectContaining({ kind: "assistant_message", detail: expect.stringContaining("inspect the checkout route") }),
          expect.objectContaining({ kind: "verification", callId: "toolu_1", detail: expect.stringContaining("PASS checkout.test.ts") })
        ])
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("normalizes OpenCode export JSON into the shared task journey model", async () => {
    const exportPath = path.resolve("tests/fixtures/opencode-exports/sample-session.json");
    const bundle = requireBundle(await opencodeAdapter.parseSource({ provider: "opencode", id: exportPath, path: exportPath, sizeBytes: 0, mtimeMs: 0 }, { repoRoot: "/tmp/superview-multi-agent" }));

    expect(bundle.session).toMatchObject({
      id: "opencode:ses_superview_1",
      provider: "opencode",
      externalSessionId: "ses_superview_1",
      cliVersion: "1.14.29"
    });
    expect(bundle.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_prompt", detail: "Add onboarding empty state" }),
        expect.objectContaining({ kind: "file_change", toolName: "edit", callId: "tool_patch_1" }),
        expect.objectContaining({ kind: "file_change", callId: "tool_patch_1", detail: expect.stringContaining("Updated ui/src/App.tsx") })
      ])
    );
    expect(bundle.events.find((event) => event.kind === "assistant_message")?.tokenUsage).toEqual({
      input: 90,
      output: 25,
      reasoning: 0,
      cachedInput: 30,
      total: 115
    });
  });

  it("keeps Codex adapter compatible with existing rollout fixtures", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "superview-codex-home-"));
    try {
      cpSync(path.resolve("tests/fixtures/fake-codex-home"), codexHome, { recursive: true });
      const sources = await codexAdapter.scan({ provider: "codex", root: codexHome });
      expect(sources).toHaveLength(1);

      const bundle = requireBundle(await codexAdapter.parseSource(sources[0], { repoRoot: "/tmp/superview-fixture" }));
      expect(bundle.session.provider).toBe("codex");
      expect(bundle.session.id).toBe("codex:fixture-tool-session");
      expect(bundle.events.some((event) => event.kind === "file_change")).toBe(true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

function requireBundle<T>(bundle: T | null): T {
  if (!bundle) throw new Error("Expected adapter to return a normalized bundle");
  return bundle;
}
