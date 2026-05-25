import { expect, test } from "@playwright/test";

test("scans fixture logs, renders timeline, opens replay, and toggles theme", async ({ page }) => {
  let timelineRequestCount = 0;
  let evidenceRequested = false;

  await page.route("**/api/projects/*/timeline?**", async (route) => {
    timelineRequestCount += 1;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("limit")).toBe("300");
    expect(url.searchParams.get("offset")).toBe(timelineRequestCount === 1 ? "0" : "300");

    const baseTime = Date.parse("2026-05-25T02:00:00.000Z");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const events = Array.from({ length: timelineRequestCount === 1 ? 300 : 40 }, (_, index) => ({
      id: `event-${offset + index}`,
      projectId: "project-fixture",
      sessionId: "fixture-tool-session",
      turnId: "turn-1",
      timestamp: new Date(baseTime + offset * 1000 + index * 1000).toISOString(),
      kind: index % 3 === 0 ? "tool_call" : "agent_message",
      lane: index % 2 === 0 ? "Code" : "Agent Runs",
      title: `Timeline event ${offset + index}`,
      detail: `Redacted event detail ${offset + index}`,
      toolName: index % 3 === 0 ? "exec_command" : null,
      callId: index % 3 === 0 ? `call-${offset + index}` : null,
      status: "success",
      files: [],
      rawEventRefId: `raw-${offset + index}`
    }));
    if (events[0]) {
      events[0].kind = "user_prompt";
      events[0].lane = "Product";
      events[0].title = `User task ${offset}`;
      events[0].detail = `Build task journey from input ${offset}`;
      events[0].toolName = null;
      events[0].callId = null;
    }
    const lastEventInLane = (lane: string) => [...events].reverse().find((event) => event.lane === lane);
    const causalEdges =
      offset === 300
        ? [
            {
              id: "edge-300-301",
              projectId: "project-fixture",
              fromEventId: "event-300",
              toEventId: "event-301",
              type: "verified_by",
              confidence: "inferred",
              reason: "Nearest successful verification after this change in the same session.",
              evidence: null
            },
            {
              id: "edge-299-300",
              projectId: "project-fixture",
              fromEventId: "event-299",
              toEventId: "event-300",
              type: "implements_prompt",
              confidence: "inferred",
              reason: "First code change after this prompt in the same session.",
              evidence: "Timeline event 299"
            }
          ]
        : [];

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        project: {
          id: "project-fixture",
          name: "superview-fixture",
          cwd: "/tmp/superview-fixture",
          repoRoot: "/tmp/superview-fixture",
          createdAt: "2026-05-25T02:00:00.000Z",
          updatedAt: "2026-05-25T02:00:00.000Z"
        },
        episodes: [
          {
            id: `episode-${offset}`,
            projectId: "project-fixture",
            startedAt: events[0].timestamp,
            endedAt: events.at(-1)?.timestamp ?? events[0].timestamp,
            title: `Episode ${offset}`,
            summary: "Grouped fixture events",
            status: "success",
            eventIds: [events[0].id]
          }
        ],
        events,
        causalEdges,
        taskJourneys: [
          {
            id: `task-${offset}`,
            projectId: "project-fixture",
            sessionId: "fixture-tool-session",
            promptEventId: events[0].id,
            startedAt: events[0].timestamp,
            endedAt: events.at(-1)?.timestamp ?? events[0].timestamp,
            title: `User task ${offset}`,
            summary: `From user input through ${events.length} event(s), 3 stage(s), ending at session end.`,
            status: "success",
            exitType: "session_end",
            eventIds: events.map((event) => event.id),
            stageCounts: {
              Product: 1,
              Code: events.filter((event) => event.lane === "Code").length,
              "Agent Runs": events.filter((event) => event.lane === "Agent Runs").length
            },
            stages: [
              {
                lane: "Product",
                count: 1,
                status: "success",
                firstEventId: events[0].id,
                lastEventId: events[0].id,
                eventIds: [events[0].id]
              },
              {
                lane: "Code",
                count: events.filter((event) => event.lane === "Code").length,
                status: "success",
                firstEventId: events.find((event) => event.lane === "Code")?.id ?? events[0].id,
                lastEventId: lastEventInLane("Code")?.id ?? events[0].id,
                eventIds: events.filter((event) => event.lane === "Code").map((event) => event.id)
              },
              {
                lane: "Agent Runs",
                count: events.filter((event) => event.lane === "Agent Runs").length,
                status: "success",
                firstEventId: events.find((event) => event.lane === "Agent Runs")?.id ?? events[0].id,
                lastEventId: lastEventInLane("Agent Runs")?.id ?? events[0].id,
                eventIds: events.filter((event) => event.lane === "Agent Runs").map((event) => event.id)
              }
            ]
          }
        ],
        totalEvents: 340,
        limit: 300,
        offset
      })
    });
  });

  await page.route("**/api/events/*/evidence", async (route) => {
    evidenceRequested = true;
    const eventId = route.request().url().match(/\/api\/events\/([^/]+)\/evidence/)?.[1] ?? "event-0";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          id: eventId,
          projectId: "project-fixture",
          sessionId: "fixture-tool-session",
          turnId: "turn-1",
          timestamp: "2026-05-25T02:00:00.000Z",
          kind: "tool_call",
          lane: "Code",
          title: `Evidence for ${eventId}`,
          detail: "Drawer detail is redacted",
          toolName: "exec_command",
          callId: "call-evidence",
          status: "success",
          files: [],
          rawEventRefId: `raw-${eventId}`
        },
        artifacts: [
          {
            id: `artifact-${eventId}`,
            eventId,
            type: "command_output",
            path: "/tmp/redacted.log",
            excerpt: "redacted command output",
            sha256: "abc123"
          }
        ],
        rawEvent: {
          id: `raw-${eventId}`,
          sessionId: "fixture-tool-session",
          lineNo: 7,
          timestamp: "2026-05-25T02:00:00.000Z",
          type: "response_item",
          redactedPayloadJson: "{\"token\":\"[REDACTED]\"}",
          sourcePath: "rollout.jsonl",
          sha256: "raw123"
        }
      })
    });
  });

  await page.goto("/");

  await page.getByRole("textbox", { name: "Codex home path", exact: true }).fill("tests/fixtures/fake-codex-home");
  await page.getByRole("button", { name: "Scan Codex Logs" }).first().click();

  await expect(page.getByText(/Ingest completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Task Journeys", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /#1 Input to exit User task 0/ })).toBeVisible();
  await expect(page.getByText("Input to exit", { exact: true })).toBeVisible();
  await expect(page.getByText("Session end")).toBeVisible();
  await expect(page.getByText("Agent Trace", { exact: true })).toBeVisible();
  await expect(page.locator(".lane-label").filter({ hasText: "Agent Runs" })).toHaveCount(0);
  await expect(page.getByText("1-300 of 340")).toBeVisible();
  await expect(page.getByText("1 task journeys loaded from 300 events")).toBeVisible();
  await expect(page.getByText("+114 more trace events")).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("301-340 of 340")).toBeVisible();
  await expect(page.getByRole("button", { name: /#1 Input to exit User task 300/ })).toBeVisible();
  await expect(page.getByText("Run Ledger")).toBeVisible();
  await page.getByRole("button", { name: "Show causal paths" }).click();
  await expect(page.getByLabel("Causal path")).toBeVisible();
  await page.getByRole("button", { name: /#1 Input to exit User task 300/ }).click({ force: true });
  await expect(page.getByText("1 causal links on this page")).toBeVisible();
  await expect(page.locator('[data-event-id="event-301"]')).toHaveClass(/causal-downstream/);
  await expect(page.getByRole("heading", { name: "Causal Links" })).toBeVisible();
  await expect(page.getByText("verified by")).toBeVisible();
  await expect(page.getByText("redacted command output")).toBeVisible();
  await expect(page.getByText("{\"token\":\"[REDACTED]\"}")).toBeVisible();
  expect(evidenceRequested).toBe(true);

  await page.locator(".run-row").first().click();
  await expect(page.getByText("Selected Run Replay")).toBeVisible();
  await page.getByRole("button", { name: /Play run/ }).click();
  await expect(page.locator(".agent")).toBeVisible();

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
