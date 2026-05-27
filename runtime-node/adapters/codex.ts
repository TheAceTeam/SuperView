import { AgentLogAdapter } from "../../core/types";
import { parseCodexJsonlFile } from "../../core/parser";
import { normalizeCodexLines } from "../../core/normalizer";
import { resolveCodexHome } from "../../storage/paths";
import { scanRolloutFiles } from "../scanner";
import { fileSource } from "./shared";

export const codexAdapter: AgentLogAdapter = {
  provider: "codex",
  async scan(config) {
    const files = await scanRolloutFiles(config?.root ?? resolveCodexHome());
    return Promise.all(files.map((file) => fileSource("codex", file)));
  },
  async parseSource(source, options = {}) {
    const lines = await parseCodexJsonlFile(source.path);
    return normalizeCodexLines(lines, {
      repoRoot: options.repoRoot,
      provider: "codex",
      prefixSessionId: true,
      modelProvider: "OpenAI",
      source: "codex"
    });
  }
};
