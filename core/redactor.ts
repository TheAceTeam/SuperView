const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)(\s*[:=]\s*)(["']?)([^"',\s}]+)/gi;
const AUTHORIZATION_HEADER_PATTERN = /(authorization\s*:\s*)(bearer\s+)?[^\r\n]+/gi;
const BEARER_PATTERN = /(bearer\s+)[a-z0-9._~+/=-]+/gi;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const RESEND_KEY_PATTERN = /\bre_[A-Za-z0-9_-]{8,}\b/g;
const ENV_SECRET_LINE_PATTERN = /^([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*).+$/gim;

export function redactString(value: string): string {
  return value
    .replace(ENV_SECRET_LINE_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_HEADER_PATTERN, "$1[REDACTED]")
    .replace(SECRET_KEY_PATTERN, "$1$2$3[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(OPENAI_KEY_PATTERN, "sk-[REDACTED]")
    .replace(RESEND_KEY_PATTERN, "re_[REDACTED]");
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|token|secret|password|passwd|authorization/i.test(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactValue(child);
      }
    }
    return redacted as T;
  }

  return value;
}

export function safeExcerpt(value: unknown, maxLength = 8000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const redacted = redactString(text ?? "");
  if (redacted.length <= maxLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxLength)}\n...[truncated ${redacted.length - maxLength} chars]`;
}
