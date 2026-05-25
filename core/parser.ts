import { readFile } from "node:fs/promises";
import { ParsedCodexLine } from "./types";
import { redactValue } from "./redactor";
import { sha256 } from "./hash";

interface CodexJsonLine {
  timestamp?: string;
  type?: string;
  payload?: unknown;
}

export function parseCodexJsonlContent(content: string, sourcePath: string): ParsedCodexLine[] {
  const lines = content.split(/\r?\n/);
  const parsed: ParsedCodexLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNo = index + 1;
    if (!raw.trim()) {
      continue;
    }

    try {
      const json = JSON.parse(raw) as CodexJsonLine;
      parsed.push({
        sourcePath,
        lineNo,
        timestamp: json.timestamp ?? new Date(0).toISOString(),
        type: json.type ?? "unknown",
        payload: json.payload ?? null,
        redactedPayload: redactValue(json.payload ?? null),
        sha256: sha256(raw)
      });
    } catch (error) {
      parsed.push({
        sourcePath,
        lineNo,
        timestamp: new Date(0).toISOString(),
        type: "parse_error",
        payload: { error: error instanceof Error ? error.message : String(error), raw },
        redactedPayload: { error: error instanceof Error ? error.message : String(error), raw: redactValue(raw) },
        sha256: sha256(raw)
      });
    }
  }

  return parsed;
}

export async function parseCodexJsonlFile(sourcePath: string): Promise<ParsedCodexLine[]> {
  const content = await readFile(sourcePath, "utf8");
  return parseCodexJsonlContent(content, sourcePath);
}
