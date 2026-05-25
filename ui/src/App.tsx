import { AlertTriangle, FileText, GitBranch, Moon, RotateCw, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, CausalEdge, EventEvidence, IngestJob, ProjectTimeline, TaskJourney, TaskJourneyDetail, TimelineEvent } from "../../core/types";
import { fetchEventEvidence, fetchIngestJob, fetchProjects, fetchTaskJourneyDetail, fetchTimeline, ProjectWithSessions, startIngest } from "./api";

type Theme = "light" | "dark";

const TIMELINE_LIMIT = 300;
const PRELOAD_JOURNEY_DETAILS = 3;

export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("superview-theme") as Theme | null) ?? "light");
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [journeyDetails, setJourneyDetails] = useState<Record<string, TaskJourneyDetail>>({});
  const [journeyLoadingIds, setJourneyLoadingIds] = useState<Record<string, boolean>>({});
  const [expandedJourneyIds, setExpandedJourneyIds] = useState<Record<string, boolean>>({});
  const [eventEvidence, setEventEvidence] = useState<EventEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [codexHome, setCodexHome] = useState("");
  const [showCausalPaths, setShowCausalPaths] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("superview-theme", theme);
  }, [theme]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadTimeline(selectedProjectId, 0);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!timeline || timeline.taskJourneys.length === 0) return;
    setSelectedJourneyId((current) => current ?? timeline.taskJourneys[0]?.id ?? null);
    for (const journey of timeline.taskJourneys.slice(0, PRELOAD_JOURNEY_DETAILS)) {
      void loadJourneyDetail(journey.id);
    }
  }, [timeline]);

  useEffect(() => {
    if (!selectedEvent) {
      setEventEvidence(null);
      return;
    }

    let cancelled = false;
    setEvidenceLoading(true);
    void fetchEventEvidence(selectedEvent.id)
      .then((next) => {
        if (!cancelled) {
          setEventEvidence(next);
          setError(null);
        }
      })
      .catch((evidenceError) => {
        if (!cancelled) {
          setEventEvidence({ event: selectedEvent, artifacts: [], rawEvent: null });
          setError(evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
        }
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      const next = await fetchIngestJob(job.id);
      setJob(next);
      if (next.status === "completed") {
        await loadProjects();
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [job]);

  async function loadProjects() {
    setLoading(true);
    try {
      const next = await fetchProjects();
      setProjects(next);
      setSelectedProjectId((current) => current ?? next[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function loadTimeline(projectId: string, offset: number) {
    setTimelineLoading(true);
    try {
      const next = await fetchTimeline(projectId, { limit: TIMELINE_LIMIT, offset });
      setTimeline(next);
      setTimelineOffset(next.offset ?? offset);
      setSelectedEvent(next.events[0] ?? null);
      setSelectedJourneyId(next.taskJourneys[0]?.id ?? null);
      setExpandedJourneyIds({});
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadNextTimelinePage() {
    if (!selectedProjectId || !timeline) return;
    const nextOffset = timelineOffset + (timeline.limit ?? TIMELINE_LIMIT);
    await loadTimeline(selectedProjectId, nextOffset);
  }

  async function loadPreviousTimelinePage() {
    if (!selectedProjectId) return;
    const previousOffset = Math.max(0, timelineOffset - TIMELINE_LIMIT);
    await loadTimeline(selectedProjectId, previousOffset);
  }

  async function handleScan() {
    setError(null);
    const jobId = await startIngest(codexHome.trim() || undefined);
    setJob(await fetchIngestJob(jobId));
  }

  async function loadJourneyDetail(journeyId: string) {
    if (journeyDetails[journeyId] || journeyLoadingIds[journeyId]) return;
    setJourneyLoadingIds((current) => ({ ...current, [journeyId]: true }));
    try {
      const detail = await fetchTaskJourneyDetail(journeyId);
      setJourneyDetails((current) => ({ ...current, [journeyId]: detail }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setJourneyLoadingIds((current) => ({ ...current, [journeyId]: false }));
    }
  }

  function selectJourney(journeyId: string) {
    setSelectedJourneyId(journeyId);
    void loadJourneyDetail(journeyId);
    const summary = timeline?.taskJourneys.find((journey) => journey.id === journeyId);
    const promptEvent = summary ? eventsById.get(summary.promptEventId) : null;
    if (promptEvent) {
      setSelectedEvent(promptEvent);
    }
  }

  function toggleJourneyDetails(journeyId: string) {
    setExpandedJourneyIds((current) => {
      const nextExpanded = !current[journeyId];
      if (nextExpanded) void loadJourneyDetail(journeyId);
      return { ...current, [journeyId]: nextExpanded };
    });
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedJourney = useMemo(() => timeline?.taskJourneys.find((journey) => journey.id === selectedJourneyId) ?? timeline?.taskJourneys[0] ?? null, [timeline, selectedJourneyId]);
  const selectedJourneyDetail = selectedJourney ? journeyDetails[selectedJourney.id] : null;
  const timelineEventsById = useMemo(() => new Map((timeline?.events ?? []).map((event) => [event.id, event])), [timeline]);
  const detailEvents = selectedJourneyDetail?.events ?? [];
  const eventsById = useMemo(() => mergeEventMaps(timelineEventsById, detailEvents), [timelineEventsById, detailEvents]);

  const selectedJourneyExpanded = selectedJourney ? Boolean(expandedJourneyIds[selectedJourney.id]) : false;
  const drawerEvent = selectedEvent;
  const drawerEvidence = eventEvidence?.event.id === drawerEvent?.id ? eventEvidence : null;
  const drawerArtifacts = drawerEvidence?.artifacts ?? [];
  const drawerEvents = useMemo(() => mergeEvents(timeline?.events ?? [], detailEvents), [timeline, detailEvents]);
  const causalEdges = selectedJourneyDetail?.causalEdges ?? timeline?.causalEdges ?? [];
  const causalView = useMemo(() => buildCausalView(drawerEvents, causalEdges, drawerEvent?.id ?? null), [drawerEvents, causalEdges, drawerEvent?.id]);
  const totalEvents = timeline?.totalEvents ?? timeline?.events.length ?? 0;
  const currentLimit = timeline?.limit ?? TIMELINE_LIMIT;
  const pageEnd = Math.min(timelineOffset + (timeline?.events.length ?? 0), totalEvents);
  const hasPreviousPage = timelineOffset > 0;
  const hasNextPage = totalEvents > timelineOffset + currentLimit;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>SuperView</strong>
          <span>Codex timeline command center</span>
        </div>
        <div className="topbar-actions">
          <label className="codex-home-control">
            <span>Codex home</span>
            <input
              aria-label="Codex home path"
              value={codexHome}
              onChange={(event) => setCodexHome(event.target.value)}
              placeholder="Server default"
            />
          </label>
          <button className="shell-button" onClick={handleScan} disabled={job?.status === "running"}>
            <RotateCw size={16} />
            Scan Codex Logs
          </button>
          <button className="icon-button" aria-label="Toggle theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="title-row">
          <div>
            <p className="eyebrow">Project Timeline</p>
            <h1>{selectedProject?.name ?? "No project indexed yet"}</h1>
            <p className="lead">Replay each user input as the Codex CLI conversation, with background work available on demand.</p>
          </div>
          <div className="status-cluster">
            <Metric label="Projects" value={projects.length} />
            <Metric label="Events" value={totalEvents} />
            <Metric label="Tasks" value={timeline?.taskJourneys.length ?? 0} />
          </div>
        </section>

        {error ? <div className="alert"><AlertTriangle size={16} />{error}</div> : null}
        {job ? <JobStrip job={job} /> : null}

        {loading ? (
          <EmptyState title="Loading SuperView index" detail="Checking local SQLite state." codexHome={codexHome} onCodexHomeChange={setCodexHome} onScan={handleScan} />
        ) : projects.length === 0 ? (
          <EmptyState title="No Codex runs indexed" detail="Scan local rollout JSONL files from ~/.codex/sessions to build the first timeline." codexHome={codexHome} onCodexHomeChange={setCodexHome} onScan={handleScan} />
        ) : (
          <div className="dashboard-grid conversation-dashboard-grid">
            <aside className="input-navigator project-input-sidebar">
              <div className="project-selector-panel">
                <label className="field-label" htmlFor="project-select">Project</label>
                <select id="project-select" value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
              <div className="panel-heading">
                <Search size={17} />
                <span>User Inputs</span>
                <em>{timeline?.taskJourneys.length ?? 0}</em>
              </div>
              <div className="input-nav-list">
                {(timeline?.taskJourneys ?? []).map((journey, index) => (
                  <button key={journey.id} className={`input-nav-row ${selectedJourney?.id === journey.id ? "active" : ""}`} onClick={() => selectJourney(journey.id)}>
                    <strong>{journey.title}</strong>
                    <small>{index + 1} · {journey.eventIds.length} events · {formatExitType(journey.exitType)}</small>
                  </button>
                ))}
              </div>
            </aside>

            <section className="timeline-panel">
              <div className="panel-heading">
                <FileText size={17} />
                <span>CLI Conversation</span>
                <em>{timelineOffset + 1}-{pageEnd} of {totalEvents}</em>
              </div>
              <div className="timeline-controls">
                <span>{timeline?.taskJourneys.length ?? 0} task journeys loaded from {timeline?.events.length ?? 0} events</span>
                <div>
                  <button className={`secondary-button ${showCausalPaths ? "active" : ""}`} onClick={() => setShowCausalPaths((current) => !current)}>
                    <GitBranch size={15} />
                    {showCausalPaths ? "Hide causal paths" : "Show causal paths"}
                  </button>
                  <button className="secondary-button" onClick={loadPreviousTimelinePage} disabled={!hasPreviousPage || timelineLoading}>Previous</button>
                  <button className="secondary-button" onClick={loadNextTimelinePage} disabled={!hasNextPage || timelineLoading}>Load more</button>
                </div>
              </div>
              {showCausalPaths ? <CausalRibbon view={causalView} /> : null}
              <ConversationThread
                journey={selectedJourneyDetail?.journey ?? selectedJourney}
                detail={selectedJourneyDetail}
                expanded={selectedJourneyExpanded}
                loading={selectedJourney ? Boolean(journeyLoadingIds[selectedJourney.id]) : false}
                selectedEventId={drawerEvent?.id ?? null}
                causalView={causalView}
                showCausalPaths={showCausalPaths}
                onToggleDetails={() => selectedJourney ? toggleJourneyDetails(selectedJourney.id) : undefined}
                onSelectEvent={(event) => {
                  setSelectedEvent(event);
                }}
              />
            </section>

            <EvidenceDrawer event={drawerEvent ?? null} artifacts={drawerArtifacts} rawEvent={drawerEvidence?.rawEvent ?? null} loading={evidenceLoading} causalEdges={causalView.directEdges} events={drawerEvents} />
          </div>
        )}
      </main>
    </div>
  );
}

interface CausalView {
  selectedId: string | null;
  upstream: Set<string>;
  downstream: Set<string>;
  context: Set<string>;
  directEdges: CausalEdge[];
  chainEdges: CausalEdge[];
  chainEvents: TimelineEvent[];
}

function buildCausalView(events: TimelineEvent[], edges: CausalEdge[], selectedId: string | null): CausalView {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const visibleEdges = edges.filter((edge) => edge.type !== "same_turn" && eventsById.has(edge.fromEventId) && eventsById.has(edge.toEventId));
  const directEdges = selectedId ? edges.filter((edge) => edge.fromEventId === selectedId || edge.toEventId === selectedId) : [];
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const context = new Set<string>();
  if (!selectedId || !eventsById.has(selectedId)) {
    return { selectedId, upstream, downstream, context, directEdges: [], chainEdges: [], chainEvents: [] };
  }

  for (const edge of directEdges) {
    if (edge.type === "same_turn") {
      context.add(edge.fromEventId === selectedId ? edge.toEventId : edge.fromEventId);
    }
  }

  walkGraph(selectedId, visibleEdges, "upstream", upstream);
  walkGraph(selectedId, visibleEdges, "downstream", downstream);
  const chainIds = new Set([selectedId, ...upstream, ...downstream]);
  const chainEdges = visibleEdges.filter((edge) => chainIds.has(edge.fromEventId) && chainIds.has(edge.toEventId));
  const chainEvents = events.filter((event) => chainIds.has(event.id)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { selectedId, upstream, downstream, context, directEdges, chainEdges, chainEvents };
}

function walkGraph(seedId: string, edges: CausalEdge[], direction: "upstream" | "downstream", visited: Set<string>) {
  const queue = [seedId];
  while (queue.length > 0 && visited.size < 40) {
    const current = queue.shift();
    if (!current) break;
    const nextIds = edges
      .filter((edge) => (direction === "upstream" ? edge.toEventId === current : edge.fromEventId === current))
      .map((edge) => (direction === "upstream" ? edge.fromEventId : edge.toEventId));
    for (const nextId of nextIds) {
      if (visited.has(nextId) || nextId === seedId) continue;
      visited.add(nextId);
      queue.push(nextId);
    }
  }
}

function mergeEvents(...eventGroups: TimelineEvent[][]): TimelineEvent[] {
  const eventsById = new Map<string, TimelineEvent>();
  for (const group of eventGroups) {
    for (const event of group) eventsById.set(event.id, event);
  }
  return [...eventsById.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function mergeEventMaps(primary: Map<string, TimelineEvent>, secondary: TimelineEvent[]): Map<string, TimelineEvent> {
  const eventsById = new Map(primary);
  for (const event of secondary) eventsById.set(event.id, event);
  return eventsById;
}

function eventItemClass(event: TimelineEvent, selectedId: string | null, causalView: CausalView, showCausalPaths: boolean) {
  const classes = ["log-entry", event.status];
  if (event.id === selectedId) classes.push("selected");
  if (showCausalPaths && selectedId) {
    if (causalView.upstream.has(event.id)) classes.push("causal-upstream");
    if (causalView.downstream.has(event.id)) classes.push("causal-downstream");
    if (causalView.context.has(event.id)) classes.push("causal-context");
    const isRelated = event.id === selectedId || causalView.upstream.has(event.id) || causalView.downstream.has(event.id) || causalView.context.has(event.id);
    if (!isRelated) classes.push("dimmed");
  }
  return classes.join(" ");
}

function CausalRibbon({ view }: { view: CausalView }) {
  if (!view.selectedId) return null;
  return (
    <section className="causal-ribbon" aria-label="Causal path">
      <div className="causal-ribbon-heading">
        <GitBranch size={15} />
        <span>Causal path</span>
        <small>{view.chainEdges.length} causal links on this page</small>
      </div>
      {view.chainEvents.length > 1 ? (
        <div className="causal-chain">
          {view.chainEvents.map((event, index) => (
            <span className="causal-chain-item" data-role={event.id === view.selectedId ? "selected" : view.upstream.has(event.id) ? "upstream" : "downstream"} key={event.id}>
              <b>{formatEventKind(event.kind)}</b>
              <em>{shortLabel(event.title)}</em>
              {index < view.chainEvents.length - 1 ? <i aria-hidden="true">&gt;</i> : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">No strong causal link is visible on the current timeline page. Same-turn context still appears in the Evidence panel.</p>
      )}
    </section>
  );
}

function ConversationThread({
  journey,
  detail,
  expanded,
  loading,
  selectedEventId,
  causalView,
  showCausalPaths,
  onToggleDetails,
  onSelectEvent
}: {
  journey: TaskJourney | null;
  detail: TaskJourneyDetail | null;
  expanded: boolean;
  loading: boolean;
  selectedEventId: string | null;
  causalView: CausalView;
  showCausalPaths: boolean;
  onToggleDetails: () => void;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  if (!journey) {
    return <p className="muted">No user-input task journeys are visible on this page.</p>;
  }

  const events = detail?.events ?? [];
  const prompt = events.find((event) => event.id === journey.promptEventId || event.kind === "user_prompt");
  const assistantMessage = events.find((event) => event.kind === "assistant_message");
  const backgroundEvents = events.filter((event) => event.kind !== "user_prompt" && event.id !== assistantMessage?.id);
  const logEvents = events.filter((event) => event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "file_change" || event.kind === "verification" || event.kind === "error");
  const codexOutput = assistantMessage?.detail ?? assistantMessage?.title ?? journey.summary;
  const promptText = prompt?.detail ?? journey.title;

  return (
    <article className={`conversation-thread ${journey.status}`}>
      <div className="conversation-summary">
        <strong>{journey.title}</strong>
        <div>
          <span>{journey.eventIds.length} events</span>
          <span>{formatExitType(journey.exitType)}</span>
          <span>{formatDate(journey.startedAt)} - {formatDate(journey.endedAt)}</span>
          {loading ? <span>Loading details</span> : null}
        </div>
      </div>

      <div className="message-thread">
        <button className={`conversation-message user ${prompt?.id === selectedEventId ? "selected" : ""}`} onClick={() => prompt ? onSelectEvent(prompt) : undefined}>
          <span className="message-meta">User</span>
          <strong>{journey.title}</strong>
          <p>{promptText}</p>
        </button>

        <button className={`conversation-message codex ${assistantMessage?.id === selectedEventId ? "selected" : ""}`} onClick={() => assistantMessage ? onSelectEvent(assistantMessage) : undefined}>
          <span className="message-meta">Codex CLI</span>
          <p>{codexOutput}</p>
        </button>
      </div>

      <button className="detail-toggle" onClick={onToggleDetails}>{expanded ? "隐藏细节" : "查看细节"}</button>

      {expanded ? (
        <div className="background-details">
          <section>
            <div className="detail-section-heading">
              <span>Background Work</span>
              <em>{backgroundEvents.length} events</em>
            </div>
            <div className="log-list">
              {backgroundEvents.length > 0 ? (
                backgroundEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId, causalView, showCausalPaths)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.kind}</span>
                    <strong>{event.title}</strong>
                    <small>{event.detail ?? formatDate(event.timestamp)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">No background work captured for this task.</p>
              )}
            </div>
          </section>

          <section>
            <div className="detail-section-heading">
              <span>Log</span>
              <em>{logEvents.length} entries</em>
            </div>
            <div className="log-list compact">
              {logEvents.length > 0 ? (
                logEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId, causalView, showCausalPaths)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.toolName ?? event.kind}</span>
                    <strong>{event.title}</strong>
                    <small>{event.detail ?? event.callId ?? formatDate(event.timestamp)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">No tool or verification log entries captured.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function formatExitType(exitType: TaskJourney["exitType"]) {
  return exitType === "next_prompt" ? "Next input" : "Session end";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  codexHome,
  onCodexHomeChange,
  onScan
}: {
  title: string;
  detail: string;
  codexHome: string;
  onCodexHomeChange: (value: string) => void;
  onScan: () => void;
}) {
  return (
    <section className="empty-state">
      <Search size={34} />
      <h2>{title}</h2>
      <p>{detail}</p>
      <label className="empty-codex-home">
        <span>Codex home path</span>
        <input aria-label="Empty Codex home path" value={codexHome} onChange={(event) => onCodexHomeChange(event.target.value)} placeholder="Blank uses server default" />
      </label>
      <button className="primary-button" onClick={onScan}>Scan Codex Logs</button>
    </section>
  );
}

function JobStrip({ job }: { job: IngestJob }) {
  const percent = job.totalFiles ? Math.round((job.processedFiles / job.totalFiles) * 100) : job.status === "completed" ? 100 : 0;
  return (
    <div className={`job-strip ${job.status}`}>
      <span>Ingest {job.status}</span>
      <div className="progress"><i style={{ width: `${percent}%` }} /></div>
      <strong>{job.processedFiles}/{job.totalFiles} files</strong>
      <span>{job.totalEvents} events</span>
    </div>
  );
}

function EvidenceDrawer({
  event,
  artifacts,
  rawEvent,
  loading,
  causalEdges,
  events
}: {
  event: TimelineEvent | null;
  artifacts: Artifact[];
  rawEvent: EventEvidence["rawEvent"];
  loading: boolean;
  causalEdges: CausalEdge[];
  events: TimelineEvent[];
}) {
  const eventsById = useMemo(() => new Map(events.map((timelineEvent) => [timelineEvent.id, timelineEvent])), [events]);
  return (
    <aside className="evidence-drawer">
      <div className="panel-heading">
        <FileText size={17} />
        <span>Evidence</span>
        {loading ? <em>Loading</em> : null}
      </div>
      {event ? (
        <>
          <div className={`status-badge ${event.status}`}>{formatEventKind(event.kind)}</div>
          <h2>{event.title}</h2>
          <dl>
            <dt>Kind</dt>
            <dd>{event.kind}</dd>
            <dt>Time</dt>
            <dd>{formatDate(event.timestamp)}</dd>
            {event.toolName ? <><dt>Tool</dt><dd>{event.toolName}</dd></> : null}
            {event.callId ? <><dt>Call</dt><dd>{event.callId}</dd></> : null}
          </dl>
          <pre>{event.detail ?? "No detail captured."}</pre>
          <h3>Causal Links</h3>
          {causalEdges.length > 0 ? (
            <div className="causal-edge-list">
              {causalEdges.map((edge) => {
                const isOutgoing = edge.fromEventId === event.id;
                const otherEvent = eventsById.get(isOutgoing ? edge.toEventId : edge.fromEventId);
                return (
                  <div className={`causal-edge ${edge.confidence}`} key={edge.id}>
                    <strong>{formatCausalType(edge.type)}</strong>
                    <small>{isOutgoing ? "Leads to" : "Comes from"}: {otherEvent?.title ?? (isOutgoing ? edge.toEventId : edge.fromEventId)}</small>
                    <p>{edge.reason}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">No causal links are visible for this event on the current page.</p>
          )}
          <h3>Artifacts</h3>
          {artifacts.length > 0 ? (
            artifacts.map((artifact) => (
              <div className="artifact" key={artifact.id}>
                <strong>{artifact.type}</strong>
                <small>{artifact.path ?? "Inline evidence"}</small>
                <pre>{artifact.excerpt}</pre>
              </div>
            ))
          ) : (
            <p className="muted">No artifacts attached to this event.</p>
          )}
          <h3>Raw Event</h3>
          {rawEvent ? (
            <div className="artifact">
              <strong>{rawEvent.type}</strong>
              <small>{rawEvent.sourcePath}:{rawEvent.lineNo}</small>
              <pre>{rawEvent.redactedPayloadJson}</pre>
            </div>
          ) : (
            <p className="muted">No raw event reference available.</p>
          )}
        </>
      ) : (
        <p className="muted">Select an episode, timeline event, or replay node to inspect redacted evidence.</p>
      )}
    </aside>
  );
}

function formatCausalType(type: CausalEdge["type"]) {
  return type.replace(/_/g, " ");
}

function formatEventKind(kind: TimelineEvent["kind"]) {
  return kind.replace(/_/g, " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortLabel(value: string) {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}
