import { ReplayNode, ReplayNodeType, SessionRecord, TimelineEvent } from "./types";

export function buildReplayNodes(events: TimelineEvent[]): ReplayNode[] {
  const runEvents = events
    .filter((event) => event.kind !== "reasoning_marker")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return runEvents.map((event, index) => ({
    id: `node-${event.id}`,
    eventId: event.id,
    type: nodeTypeForEvent(event),
    label: labelForEvent(event),
    timestamp: event.timestamp,
    status: event.status,
    lane: event.lane,
    x: 80 + index * 120,
    detail: event.detail
  }));
}

export function buildRunReplay(session: SessionRecord, events: TimelineEvent[]) {
  return {
    session,
    events,
    nodes: buildReplayNodes(events),
    artifacts: []
  };
}

function nodeTypeForEvent(event: TimelineEvent): ReplayNodeType {
  if (event.kind === "user_prompt") return "start";
  if (event.kind === "file_change") return "powerup";
  if (event.kind === "verification" && event.status === "success") return "finish";
  if (event.kind === "verification") return "platform";
  if (event.status === "failed" || event.kind === "error") return "hazard";
  if (/read|search|rg|find|open/i.test(`${event.title} ${event.detail ?? ""}`)) return "context";
  if (/retry|again|loop/i.test(`${event.title} ${event.detail ?? ""}`)) return "loop";
  if (event.kind === "tool_call" || event.kind === "tool_result") return "platform";
  return "message";
}

function labelForEvent(event: TimelineEvent): string {
  if (event.kind === "user_prompt") return "Start";
  if (event.kind === "file_change") return "Patch";
  if (event.kind === "verification" && event.status === "success") return "Flag";
  if (event.kind === "verification") return "Check";
  if (event.status === "failed" || event.kind === "error") return "Hazard";
  if (event.kind === "tool_call") return event.toolName ?? "Tool";
  return event.title.length > 18 ? `${event.title.slice(0, 15)}...` : event.title;
}
