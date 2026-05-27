import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AgentLogAdapter, AgentLogSource, NormalizedBundle, ParsedAgentEvent, TokenUsage } from "../../core/types";
import { normalizeCodexLines } from "../../core/normalizer";
import { asRecord, makeTokenUsage, numberTimestamp, parsedEvent, readJsonFile, stringValue } from "./shared";

const execFileAsync = promisify(execFile);

export const opencodeAdapter: AgentLogAdapter = {
  provider: "opencode",
  async scan(config) {
    if (config?.path) {
      return [await fileLikeSource(config.path)];
    }
    const stdout = await runOpencode(["session", "list", "--format", "json"]);
    const sessions = stdout.trim() ? asArray(JSON.parse(stdout)) : [];
    const tempDir = await mkdtemp(path.join(tmpdir(), "superview-opencode-export-"));
    const sources: AgentLogSource[] = [];
    for (const session of sessions) {
      const record = asRecord(session);
      const id = stringValue(record.id) ?? stringValue(record.sessionID) ?? stringValue(record.sessionId);
      if (!id) continue;
      const exported = await runOpencode(["export", id, "--sanitize"]);
      const exportPath = path.join(tempDir, `${id}.json`);
      await writeFile(exportPath, exported, "utf8");
      sources.push(await fileLikeSource(exportPath));
    }
    return sources;
  },
  async parseSource(source, options = {}) {
    const json = await readJsonFile(source.path);
    return normalizeOpenCodeExport(json, source.path, options.repoRoot);
  }
};

export function normalizeOpenCodeExport(json: unknown, sourcePath: string, repoRoot?: string | null): NormalizedBundle | null {
  const root = asRecord(json);
  const session = asRecord(root.session ?? root);
  const messages = asArray(root.messages ?? root.message ?? root.parts);
  const externalSessionId = stringValue(session.id) ?? path.basename(sourcePath, ".json");
  const cwd = stringValue(session.cwd) ?? stringValue(root.cwd) ?? process.cwd();
  const startedAt = timestampFromValue(asRecord(session.time).created ?? session.created ?? messages[0]);
  const version = stringValue(session.version) ?? stringValue(root.version);
  const lines: ParsedAgentEvent[] = [
    parsedEvent({
      provider: "opencode",
      sourcePath,
      lineNo: 1,
      timestamp: startedAt,
      type: "session_meta",
      payload: {
        id: externalSessionId,
        timestamp: startedAt,
        cwd,
        cli_version: version,
        model_provider: stringValue(session.provider) ?? null,
        source: "opencode"
      }
    })
  ];

  let lineNo = 2;
  for (const messageValue of messages) {
    const message = asRecord(messageValue);
    const timestamp = timestampFromValue(asRecord(message.time).created ?? message.created ?? message.timestamp);
    const role = stringValue(message.role) ?? stringValue(message.type);
    const parts = asArray(message.parts ?? message.content);
    const usage = makeTokenUsage(message.tokens ?? message.usage);

    const messageText = textFromParts(parts.length > 0 ? parts : message.content);
    if ((role === "user" || role === "assistant") && messageText) {
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "message",
            role,
            content: [{ type: role === "assistant" ? "output_text" : "input_text", text: messageText }],
            ...(usage ? { usage } : {})
          }
        })
      );
      lineNo += 1;
    }

    for (const part of parts) {
      const partRecord = asRecord(part);
      if (!isToolPart(partRecord)) continue;
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: stringValue(partRecord.id) ?? stringValue(partRecord.callID) ?? stringValue(partRecord.callId),
            name: stringValue(partRecord.tool) ?? stringValue(partRecord.name) ?? "tool",
            arguments: JSON.stringify(partRecord.input ?? partRecord.arguments ?? {})
          }
        })
      );
      lineNo += 1;
    }

    if (role === "tool") {
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: stringValue(message.toolCallId) ?? stringValue(message.tool_call_id) ?? stringValue(message.callId),
            output: messageText || JSON.stringify(message)
          }
        })
      );
      lineNo += 1;
    }
  }

  return normalizeCodexLines(lines, {
    repoRoot,
    provider: "opencode",
    prefixSessionId: true,
    modelProvider: stringValue(session.provider) ?? null,
    source: "opencode",
    agentName: "OpenCode"
  });
}

async function fileLikeSource(filePath: string): Promise<AgentLogSource> {
  const content = await readFile(filePath, "utf8");
  const stats = await stat(filePath);
  return {
    provider: "opencode",
    id: `opencode:${filePath}`,
    path: filePath,
    sizeBytes: Buffer.byteLength(content),
    mtimeMs: stats.mtimeMs
  };
}

async function runOpencode(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("opencode", args, {
    maxBuffer: 50 * 1024 * 1024
  });
  return stdout;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "data", "sessions", "messages"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function timestampFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  const numeric = numberTimestamp(value);
  return numeric ?? new Date(0).toISOString();
}

function textFromParts(value: unknown): string {
  if (typeof value === "string") return value;
  return asArray(value)
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return stringValue(record.text) ?? stringValue(record.content) ?? stringValue(record.output) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function isToolPart(part: Record<string, unknown>) {
  const type = stringValue(part.type);
  return type === "tool" || type === "tool_call" || Boolean(part.tool ?? part.name);
}
