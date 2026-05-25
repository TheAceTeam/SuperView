import { sha256 } from "./hash";

export function stableId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const joined = parts.map((part) => String(part ?? "")).join("\u001f");
  return `${prefix}_${sha256(joined).slice(0, 20)}`;
}
