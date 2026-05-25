import { addMinutes, differenceInMinutes, isValid, parseISO } from "date-fns";
import { CausalConfidence, CausalEdge, CausalEdgeType, Episode, EventStatus, ProjectRecord, ProjectTimeline, TaskJourney, TaskJourneyStage, TimelineEvent, TimelineLane } from "./types";
import { stableId } from "./id";

const EPISODE_GAP_MINUTES = 90;

export function buildProjectTimeline(project: ProjectRecord, events: TimelineEvent[]): ProjectTimeline {
  const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    project,
    events: sortedEvents,
    episodes: groupEpisodes(project.id, sortedEvents),
    causalEdges: buildCausalEdges(project.id, sortedEvents),
    taskJourneys: buildTaskJourneys(project.id, sortedEvents)
  };
}

export function buildTaskJourneys(projectId: string, events: TimelineEvent[]): TaskJourney[] {
  const projectEvents = events
    .filter((event) => event.projectId === projectId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const promptIndexes = projectEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === "user_prompt");

  return promptIndexes.map(({ event: prompt, index }, promptIndex) => {
    const nextPrompt = promptIndexes[promptIndex + 1]?.event;
    const endIndex = nextPrompt ? projectEvents.findIndex((event) => event.id === nextPrompt.id) : projectEvents.length;
    const journeyEvents = projectEvents.slice(index, endIndex);
    const end = journeyEvents.at(-1) ?? prompt;
    const stages = buildTaskJourneyStages(journeyEvents);
    const failures = journeyEvents.filter((event) => event.status === "failed").length;
    const successes = journeyEvents.filter((event) => event.lane === "Verification" && event.status === "success").length;
    const status: EventStatus = failures > 0 ? "failed" : successes > 0 ? "success" : "unknown";
    const stageCounts = stages.reduce<Partial<Record<TimelineLane, number>>>((counts, stage) => {
      counts[stage.lane] = stage.count;
      return counts;
    }, {});

    return {
      id: stableId("task_journey", projectId, prompt.id, end.id),
      projectId,
      sessionId: prompt.sessionId,
      promptEventId: prompt.id,
      startedAt: prompt.timestamp,
      endedAt: end.timestamp,
      title: prompt.title,
      summary: `From user input through ${journeyEvents.length} event(s), ${stages.length} stage(s), ending at ${nextPrompt ? "next user input" : "session end"}.`,
      status,
      exitType: nextPrompt ? "next_prompt" : "session_end",
      eventIds: journeyEvents.map((event) => event.id),
      stageCounts,
      stages
    };
  });
}

function buildTaskJourneyStages(events: TimelineEvent[]): TaskJourneyStage[] {
  const laneOrder: TimelineLane[] = ["Product", "Architecture", "Code", "Agent Runs", "Verification", "Risks"];
  return laneOrder.flatMap((lane) => {
    const laneEvents = events.filter((event) => event.lane === lane);
    if (laneEvents.length === 0) return [];
    const failures = laneEvents.filter((event) => event.status === "failed").length;
    const successes = laneEvents.filter((event) => event.status === "success").length;
    const status: EventStatus = failures > 0 ? "failed" : successes > 0 ? "success" : "unknown";
    const first = laneEvents[0];
    const last = laneEvents.at(-1) ?? first;
    return [
      {
        lane,
        count: laneEvents.length,
        status,
        firstEventId: first.id,
        lastEventId: last.id,
        eventIds: laneEvents.map((event) => event.id)
      }
    ];
  });
}

export function buildCausalEdges(projectId: string, events: TimelineEvent[]): CausalEdge[] {
  const sortedEvents = events
    .filter((event) => event.projectId === projectId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byId = new Map(sortedEvents.map((event) => [event.id, event]));
  const edges = new Map<string, CausalEdge>();

  const addEdge = (
    from: TimelineEvent | undefined,
    to: TimelineEvent | undefined,
    type: CausalEdgeType,
    confidence: CausalConfidence,
    reason: string,
    evidence: string | null = null
  ) => {
    if (!from || !to || from.id === to.id) return;
    const key = `${from.id}:${to.id}:${type}`;
    if (edges.has(key)) return;
    edges.set(key, {
      id: stableId("causal", projectId, from.id, to.id, type),
      projectId,
      fromEventId: from.id,
      toEventId: to.id,
      type,
      confidence,
      reason,
      evidence
    });
  };

  for (let index = 1; index < sortedEvents.length; index += 1) {
    const previous = sortedEvents[index - 1];
    const current = sortedEvents[index];
    if (previous.turnId && current.turnId === previous.turnId) {
      addEdge(previous, current, "same_turn", "deterministic", `Same turn_id ${current.turnId}.`, current.turnId);
    }
  }

  for (const event of sortedEvents) {
    const output = event.outputEventId ? byId.get(event.outputEventId) : undefined;
    if (output) {
      addEdge(event, output, output.status === "failed" ? "failed_by" : "same_call", "deterministic", `Function call ${event.callId ?? event.id} produced this output.`, event.callId);
    }
  }

  for (const prompt of sortedEvents.filter((event) => event.kind === "user_prompt")) {
    const afterPrompt = sortedEvents.filter((event) => isAfter(event, prompt) && event.sessionId === prompt.sessionId);
    addEdge(
      prompt,
      afterPrompt.find((event) => event.lane === "Architecture" && (event.kind === "file_change" || event.kind === "tool_call")),
      "updates_design",
      "inferred",
      "First architecture or design artifact after this prompt in the same session.",
      prompt.title
    );
    addEdge(
      prompt,
      afterPrompt.find((event) => event.lane === "Code" && (event.kind === "file_change" || event.toolName === "git")),
      "implements_prompt",
      "inferred",
      "First code change after this prompt in the same session.",
      prompt.title
    );
  }

  for (const event of sortedEvents) {
    const laterInSession = sortedEvents.filter((candidate) => isAfter(candidate, event) && candidate.sessionId === event.sessionId);
    if ((event.lane === "Code" || event.lane === "Architecture") && event.status !== "failed") {
      addEdge(
        event,
        laterInSession.find((candidate) => candidate.lane === "Verification" && candidate.status === "success"),
        "verified_by",
        "inferred",
        "Nearest successful verification after this change in the same session."
      );
      addEdge(
        event,
        laterInSession.find((candidate) => candidate.toolName === "git" || Boolean(candidate.commitHash)),
        "committed_as",
        "deterministic",
        "Nearest git commit after this change in the same session."
      );
    }

    if (event.status === "failed") {
      addEdge(
        event,
        laterInSession.find(isRetryEvent),
        "retried_by",
        "inferred",
        "A later agent message or command indicates the failed step was retried."
      );
    } else {
      addEdge(
        event,
        laterInSession.find((candidate) => candidate.status === "failed" && (candidate.lane === "Risks" || candidate.lane === "Verification")),
        "failed_by",
        "inferred",
        "Nearest failed verification or risk event after this step in the same session."
      );
    }
  }

  return [...edges.values()].sort((a, b) => {
    const fromDelta = (byId.get(a.fromEventId)?.timestamp ?? "").localeCompare(byId.get(b.fromEventId)?.timestamp ?? "");
    return fromDelta || (byId.get(a.toEventId)?.timestamp ?? "").localeCompare(byId.get(b.toEventId)?.timestamp ?? "") || a.type.localeCompare(b.type);
  });
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

function isAfter(candidate: TimelineEvent, base: TimelineEvent): boolean {
  return candidate.timestamp > base.timestamp || (candidate.timestamp === base.timestamp && candidate.id > base.id);
}

function isRetryEvent(event: TimelineEvent): boolean {
  return /\bretry\b|\bretrying\b|重试|再次尝试/i.test(`${event.title}\n${event.detail ?? ""}`);
}

export function makePlaceholderDate(seed: string): string {
  const date = parseISO(seed);
  return isValid(date) ? date.toISOString() : addMinutes(new Date(0), 1).toISOString();
}
