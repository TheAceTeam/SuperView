import { addMinutes, differenceInMinutes, isValid, parseISO } from "date-fns";
import { Episode, EventStatus, ProjectRecord, ProjectTimeline, TimelineEvent } from "./types";
import { stableId } from "./id";

const EPISODE_GAP_MINUTES = 90;

export function buildProjectTimeline(project: ProjectRecord, events: TimelineEvent[]): ProjectTimeline {
  const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    project,
    events: sortedEvents,
    episodes: groupEpisodes(project.id, sortedEvents)
  };
}

export function groupEpisodes(projectId: string, events: TimelineEvent[]): Episode[] {
  const projectEvents = events.filter((event) => event.projectId === projectId);
  if (projectEvents.length === 0) return [];

  const groups: TimelineEvent[][] = [];
  let current: TimelineEvent[] = [];

  for (const event of projectEvents) {
    const previous = current.at(-1);
    if (!previous || previous.sessionId === event.sessionId || minutesBetween(previous.timestamp, event.timestamp) <= EPISODE_GAP_MINUTES) {
      current.push(event);
    } else {
      groups.push(current);
      current = [event];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const start = group[0];
    const end = group.at(-1) ?? start;
    const prompt = group.find((event) => event.kind === "user_prompt");
    const failures = group.filter((event) => event.status === "failed").length;
    const verifications = group.filter((event) => event.lane === "Verification" && event.status === "success").length;
    const status: EventStatus = failures > 0 ? "failed" : verifications > 0 ? "success" : "unknown";

    return {
      id: stableId("episode", projectId, start.timestamp, end.timestamp, index),
      projectId,
      startedAt: start.timestamp,
      endedAt: end.timestamp,
      title: prompt?.title ?? `Auto grouped episode ${index + 1}`,
      summary: `Auto grouped ${group.length} events across ${new Set(group.map((event) => event.sessionId)).size} run(s).`,
      status,
      eventIds: group.map((event) => event.id)
    };
  });
}

function minutesBetween(left: string, right: string): number {
  const a = parseISO(left);
  const b = parseISO(right);
  if (!isValid(a) || !isValid(b)) {
    return 0;
  }
  return Math.abs(differenceInMinutes(b, a));
}

export function makePlaceholderDate(seed: string): string {
  const date = parseISO(seed);
  return isValid(date) ? date.toISOString() : addMinutes(new Date(0), 1).toISOString();
}
