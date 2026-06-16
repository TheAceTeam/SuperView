import type { SessionRecord, TaskJourney, TokenUsage } from "./types";

/** A single pricing tier matched by model name substring. */
export interface ModelPricing {
  id: string;
  provider: "Anthropic" | "OpenAI" | "Other";
  label: string;
  test: RegExp;
  inRate: number;   // $/1M input tokens
  outRate: number;  // $/1M output tokens
}

/** Default pricing table (USD per 1M tokens, standard API tiers, June 2026). */
export const DEFAULT_PRICING: ModelPricing[] = [
  // Anthropic (Claude Code)
  { id: "sonnet",  provider: "Anthropic", label: "Sonnet",       test: /sonnet/i,             inRate: 3,   outRate: 15  },
  { id: "haiku45", provider: "Anthropic", label: "Haiku 4.5",    test: /haiku-?4-?5/i,        inRate: 1,   outRate: 5   },
  { id: "haiku",   provider: "Anthropic", label: "Haiku (3.x)",  test: /haiku/i,              inRate: 0.8, outRate: 4   },
  { id: "opus4x",  provider: "Anthropic", label: "Opus 4.5–4.8", test: /opus-?4-?(5|6|7|8)/i, inRate: 5,   outRate: 25  },
  { id: "opus",    provider: "Anthropic", label: "Opus",         test: /opus/i,               inRate: 5,   outRate: 25  },

  // OpenAI (Codex)
  { id: "oMini",   provider: "OpenAI", label: "GPT mini",   test: /mini/i,               inRate: 0.45, outRate: 3.6  },
  { id: "oGpt5",   provider: "OpenAI", label: "GPT-5",      test: /(gpt-?5|o3|o4)/i,     inRate: 2.5,  outRate: 15  },
  { id: "o55",     provider: "OpenAI", label: "GPT-5.5",    test: /gpt-?5\.?5/i,         inRate: 5,    outRate: 30  },

  // Provider-level defaults (when session only records provider, not model)
  { id: "anthropic",  provider: "Anthropic", label: "Claude (unspecified)", test: /anthropic/i, inRate: 3,   outRate: 15 },
  { id: "openai",     provider: "OpenAI",    label: "GPT (unspecified)",    test: /openai/i,    inRate: 2.5, outRate: 15 },

  // Fallback
  { id: "unknown", provider: "Other", label: "Unknown", test: /.*/, inRate: 3, outRate: 15 },
];

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = 1.25;

/** Match a pricing tier from a model string. */
export function matchPricing(model: string | null | undefined, pricing = DEFAULT_PRICING): ModelPricing {
  const m = model ?? "";
  for (const p of pricing) {
    if (p.test.test(m)) return p;
  }
  return pricing[pricing.length - 1];
}

/** Estimate the cost of a single TokenUsage record. */
export function estimateCost(
  usage: TokenUsage | null | undefined,
  model: string | null | undefined,
  pricing = DEFAULT_PRICING
): number {
  if (!usage) return 0;
  const p = matchPricing(model, pricing);
  const inputCost = (usage.input ?? 0) * p.inRate / 1_000_000;
  const outputCost = (usage.output ?? 0) * p.outRate / 1_000_000;
  const cachedCost = (usage.cachedInput ?? 0) * p.inRate * CACHE_READ_MULT / 1_000_000;
  return inputCost + outputCost + cachedCost;
}

/** Estimated total cost from a project's token usage. */
export function estimateProjectCost(usage: TokenUsage | null | undefined, model?: string, pricing?: ModelPricing[]): number {
  return estimateCost(usage, model ?? "sonnet", pricing);
}

/** Per-model cost breakdown for a set of task journeys. */
export interface ModelCostBreakdown {
  model: string;
  label: string;
  provider: string;
  input: number;
  output: number;
  cachedInput: number;
  messages: number;
  cost: number;
}

/** Aggregate token usage and cost by model across journeys. */
export function aggregateCostByModel(
  journeys: TaskJourney[],
  sessionMap: Map<string, SessionRecord>,
  pricing = DEFAULT_PRICING
): ModelCostBreakdown[] {
  const byModel = new Map<string, {
    label: string;
    provider: string;
    input: number;
    output: number;
    cachedInput: number;
    messages: number;
    cost: number;
  }>();

  for (const journey of journeys) {
    const session = sessionMap.get(journey.sessionId);
    const model = session?.modelProvider ?? null;
    const pricingTier = matchPricing(model, pricing);

    const key = pricingTier.id;
    const entry = byModel.get(key) ?? {
      label: pricingTier.label,
      provider: pricingTier.provider,
      input: 0,
      output: 0,
      cachedInput: 0,
      messages: 0,
      cost: 0,
    };

    entry.input += journey.tokenUsage?.input ?? 0;
    entry.output += journey.tokenUsage?.output ?? 0;
    entry.cachedInput += journey.tokenUsage?.cachedInput ?? 0;
    entry.messages += 1;
    entry.cost += estimateCost(journey.tokenUsage, model, pricing);
    byModel.set(key, entry);
  }

  return [...byModel.entries()]
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.cost - a.cost);
}

/** Format a USD cost for display. */
export function formatCost(value: number): string {
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}
