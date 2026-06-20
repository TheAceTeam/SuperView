import path from "node:path";
import { mkdirSync } from "node:fs";

export function resolveDataDir(): string {
  return process.env.SUPERVIEW_DATA_DIR ?? path.resolve(process.cwd(), ".superview");
}

export function resolveDatabasePath(): string {
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "superview.sqlite");
}

export function resolveCodexHome(): string {
  return process.env.SUPERVIEW_CODEX_HOME ?? path.join(process.env.HOME ?? process.cwd(), ".codex");
}

export function resolveClaudeHome(): string {
  return process.env.SUPERVIEW_CLAUDE_HOME ?? path.join(process.env.HOME ?? process.cwd(), ".claude");
}

export function opencodeDbCandidates(): string[] {
  if (process.env.SUPERVIEW_OPENCODE_DB) return [process.env.SUPERVIEW_OPENCODE_DB];
  const home = process.env.HOME ?? process.cwd();
  return [
    path.join(home, ".local", "share", "opencode", "opencode.db"),
    path.join(home, ".opencode", "opencode.db")
  ];
}
