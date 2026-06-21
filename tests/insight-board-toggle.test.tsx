import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { COPY } from "../ui/src/i18n";
import { InsightBoard } from "../ui/src/App";
import type { JourneyInsight } from "../ui/src/insights";

describe("InsightBoard mode toggle", () => {
  test("switches between full and compact cards without losing selection", () => {
    const onSelectJourney = vi.fn();

    render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={onSelectJourney}
      />,
    );

    const board = screen.getByLabelText("High-signal task insights");
    expect(within(board).getByText("Tool loop pressure")).toBeInTheDocument();
    expect(within(board).getByText("4 repeated tool calls")).toBeInTheDocument();
    expect(within(board).getByText("4 tools")).toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: "Compact insight board" }));

    expect(within(board).getByText("Tool loop pressure")).toBeInTheDocument();
    expect(within(board).queryByText("4 repeated tool calls")).not.toBeInTheDocument();
    expect(within(board).queryByText("4 tools")).not.toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: /Tool loop pressure.*Risky task/ }));

    expect(onSelectJourney).toHaveBeenCalledWith("journey-risk");
    expect(within(board).getByRole("button", { name: "Expand insight board" })).toBeInTheDocument();
  });
});

const insight: JourneyInsight = {
  id: "insight-risk",
  journeyId: "journey-risk",
  severity: "medium",
  score: 28,
  title: "Risky task",
  primaryKind: "tool_loop",
  signals: [{ kind: "tool_loop", score: 28, metric: 4 }],
  metrics: {
    tokens: 12_900,
    toolCalls: 4,
    errors: 0,
    files: 0,
    verificationEvents: 0,
    contextEvents: 0,
  },
};
