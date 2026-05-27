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
