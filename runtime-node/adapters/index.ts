import { AgentLogAdapter, AgentProvider } from "../../core/types";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";

const adapters: Record<AgentProvider, AgentLogAdapter> = {
  codex: codexAdapter,
  "claude-code": claudeCodeAdapter,
  opencode: opencodeAdapter
};

export function adapterForProvider(provider: AgentProvider): AgentLogAdapter {
  return adapters[provider];
}

export function defaultAdapters(): AgentLogAdapter[] {
  return [codexAdapter];
}
