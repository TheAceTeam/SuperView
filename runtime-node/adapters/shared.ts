import { readFile, stat } from "node:fs/promises";
import { AgentLogSource, AgentProvider, ParsedAgentEvent, TimelineEvent, TokenUsage } from "../../core/types";
import { redactValue } from "../../core/redactor";
import { sha256 } from "../../core/hash";

export async function fileSource(provider: AgentProvider, filePath: string): Promise<AgentLogSource> {
  const stats = await stat(filePath);
  return {
    provider,
    id: `${provider}:${filePath}`,
    path: filePath,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

export async function readJsonFile(sourcePath: string): Promise<unknown> {
  return JSON.parse(await readFile(sourcePath, "utf8"));
}

export function parsedEvent(input: {
  provider: AgentProvider;
  sourcePath: string;
  lineNo: number;
  timestamp: string;
  type: string;
  payload: unknown;
  raw?: string;
}): ParsedAgentEvent {
  const raw = input.raw ?? JSON.stringify({ timestamp: input.timestamp, type: input.type, payload: input.payload });
  return {
    provider: input.provider,
    sourcePath: input.sourcePath,
    lineNo: input.lineNo,
    timestamp: input.timestamp,
    type: input.type,
    payload: input.payload,
    redactedPayload: redactValue(input.payload),
    sha256: sha256(raw)
  };
}

export function makeTokenUsage(value: unknown): TokenUsage | null {
  const rawInput = firstNumber(value, ["input_tokens", "prompt_tokens", "input", "prompt"]);
  const output = firstNumber(value, ["output_tokens", "completion_tokens", "output", "completion"]);
  const reasoning = firstNumber(value, ["reasoning_tokens", "reasoning", "reasoning_output_tokens"]);
  // OpenAI/Codex style: cached_tokens / cached_input_tokens are ALREADY included in prompt_tokens/input_tokens.
  // Anthropic style: cache_read_input_tokens and cache_creation_input_tokens are reported SEPARATELY from input_tokens.
  const cachedRead = firstNumber(value, ["cached_input_tokens", "cached_tokens", "cache_read_input_tokens", "cached_input", "cache_read", "read"]);
  const anthropicCacheRead = firstNumber(value, ["cache_read_input_tokens"]);
  const anthropicCacheCreation = firstNumber(value, ["cache_creation_input_tokens"]);
  const explicitTotal = firstNumber(value, ["total_tokens", "total"]);
  const isAnthropicStyle = anthropicCacheRead !== null || anthropicCacheCreation !== null;
  const input = isAnthropicStyle
    ? (rawInput ?? 0) + (anthropicCacheRead ?? 0) + (anthropicCacheCreation ?? 0)
    : rawInput;
  const cachedInput = isAnthropicStyle ? (anthropicCacheRead ?? 0) : cachedRead;
  const total = explicitTotal ?? sumKnown(input, output);
  if (rawInput === null && output === null && reasoning === null && cachedRead === null && total === null && !isAnthropicStyle) return null;
  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
    cachedInput: cachedInput ?? 0,
    total: total ?? 0
  };
}

export function attachTokenUsage(event: TimelineEvent, usage: TokenUsage | null): TimelineEvent {
  return usage ? { ...event, tokenUsage: usage } : event;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function numberTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function firstNumber(value: unknown, keys: string[]): number | null {
  const matches = collectNumbers(value, new Set(keys.map(normalizeKey)));
  return matches[0] ?? null;
}

function collectNumbers(value: unknown, keys: Set<string>): number[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectNumbers(item, keys));
  const matches: number[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(normalizeKey(key)) && typeof child === "number" && Number.isFinite(child) && child >= 0) {
      matches.push(Math.trunc(child));
    }
    if (child && typeof child === "object") {
      matches.push(...collectNumbers(child, keys));
    }
  }
  return matches;
}

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sumKnown(...values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}
