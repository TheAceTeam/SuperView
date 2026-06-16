import { useId, useMemo, useState } from "react";
import type { DailyTokenUsagePoint, DailyTokenUsageResponse, TokenUsage } from "../../core/types";
import type { TokenChartCopy } from "./i18n";
import { formatMillionTokens } from "./tokenFormat";

export type ChartVariant = "bar" | "area" | "horizon";

export interface DailyTokenUsagePanelProps {
  data?: DailyTokenUsageResponse | DailyTokenUsagePoint[] | null;
  loading?: boolean;
  initiallyExpanded?: boolean;
  title?: string;
  subtitle?: string;
  showHeaderToggle?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  maxVisiblePoints?: number;
  className?: string;
  copy?: TokenChartCopy;
  variant?: ChartVariant;
}

interface TokenParts {
  cachedInput: number;
  input: number;
  output: number;
  reasoning: number;
  other: number;
  total: number;
}

interface ChartSegment {
  key: string;
  label: string;
  value: number;
  y: number;
  height: number;
  className: string;
}

interface ChartBar {
  key: string;
  label: string;
  total: number;
  centerX: number;
  trendY: number;
  x: number;
  y: number;
  width: number;
  segments: ChartSegment[];
}

interface AreaLayer {
  key: string;
  label: string;
  className: string;
  path: string;
}

interface AreaChartData {
  width: number;
  bottom: number;
  layers: AreaLayer[];
  trendPath: string;
  gridLines: { value: number; y: number }[];
  centerXs: number[];
  trendYs: number[];
  dateLabels: { x: number; label: string }[];
  maxTotal: number;
}

interface HorizonBand {
  className: string;
  path: string;
}

interface HorizonRow {
  key: string;
  label: string;
  bands: HorizonBand[];
}

interface HorizonChartData {
  width: number;
  height: number;
  bottom: number;
  rows: HorizonRow[];
  dateLabels: { x: number; label: string }[];
}

interface ChartBarData {
  width: number;
  bottom: number;
  bars: ChartBar[];
  trendPath: string;
  gridLines: { value: number; y: number }[];
}

const SVG_HEIGHT = 200;
const MIN_SVG_WIDTH = 360;
const POINT_WIDTH = 22;
const CHART_MARGIN = {
  top: 20,
  right: 24,
  bottom: 44,
  left: 58
};

const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  style: "percent"
});

export function DailyTokenUsagePanel({
  data,
  loading = false,
  initiallyExpanded = false,
  title = "Daily Token Usage",
  subtitle,
  showHeaderToggle = true,
  expanded: controlledExpanded,
  onExpandedChange,
  maxVisiblePoints,
  className,
  copy,
  variant = "bar"
}: DailyTokenUsagePanelProps) {
  const text = copy;
  const panelTitle = title ?? text?.defaultTitle ?? "Daily Token Usage";
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(initiallyExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const headingId = useId();
  const bodyId = useId();
  const chartTitleId = useId();
  const visiblePoints = useMemo(() => normalizePoints(data, maxVisiblePoints), [data, maxVisiblePoints]);
  const summary = useMemo(() => summarizePoints(visiblePoints), [visiblePoints]);
  const chart = useMemo(() => buildChart(visiblePoints, variant), [visiblePoints, variant]);
  const hasPoints = visiblePoints.length > 0;
  const panelClassName = className ? `token-chart-panel ${className}` : "token-chart-panel";
  const subtitleText = subtitle ?? (loading ? text?.loading ?? "Loading daily usage" : hasPoints ? text?.visibleDays(visiblePoints.length) ?? `${visiblePoints.length} visible day${visiblePoints.length === 1 ? "" : "s"}` : text?.noVisibleDays ?? "No visible days");

  function setExpanded(next: boolean) {
    onExpandedChange?.(next);
    if (controlledExpanded === undefined) setUncontrolledExpanded(next);
  }

  return (
    <section className={panelClassName} aria-labelledby={headingId}>
      <div className="token-chart-header">
        <div className="token-chart-title-block">
          <p className="token-chart-eyebrow">{text?.eyebrow ?? "Tokens"}</p>
          <h2 id={headingId} className="token-chart-title">
            {panelTitle}
          </h2>
          <p className="token-chart-subtitle">{subtitleText}</p>
        </div>

        {showHeaderToggle ? <dl className="token-chart-summary" aria-label={text?.summaryAria ?? "Daily token usage summary"}>
          <div className="token-chart-summary-item">
            <dt>{text?.totalTokens ?? "Total tokens"}</dt>
            <dd>{formatTokens(summary.total)}</dd>
          </div>
          <div className="token-chart-summary-item">
            <dt>{text?.kvHit ?? "KV hit"}</dt>
            <dd>{formatKvHit(summary.kvHit)}</dd>
          </div>
        </dl> : null}

        {showHeaderToggle ? <button
          className="token-chart-toggle"
          type="button"
          aria-controls={bodyId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{expanded ? text?.hideChart ?? "Hide daily token usage chart" : text?.showChart ?? "Show daily token usage chart"}</span>
          <span className="token-chart-toggle-icon" aria-hidden="true">
            {expanded ? "-" : "+"}
          </span>
        </button> : null}
      </div>

      {expanded ? (
        <div id={bodyId} className="token-chart-body">
          {hasPoints ? (
            <>
              <div className="token-chart-kpis" aria-label={text?.breakdownAria ?? "Visible token usage breakdown"}>
                <Metric label={text?.input ?? "Input"} value={summary.input} />
                <Metric label={text?.cachedInput ?? "Cached input"} value={summary.cachedInput} />
                <Metric label={text?.output ?? "Output"} value={summary.output} />
                <Metric label={text?.reasoning ?? "Reasoning"} value={summary.reasoning} />
              </div>

              <div className="token-chart-scroll" role="group" aria-label={text?.chartAria ?? "Daily token usage chart"}>
                {variant === "horizon" ? renderHorizonChart(chart as HorizonChartData, text, chartTitleId) : (
                <svg
                  className="token-chart-svg"
                  role="img"
                  aria-labelledby={chartTitleId}
                  viewBox={`0 0 ${chart.width} ${SVG_HEIGHT}`}
                  width={chart.width}
                  height={SVG_HEIGHT}
                >
                  <title id={chartTitleId}>{text?.chartTitle ?? "Daily token usage by date"}</title>
                  {(chart as ChartBarData | AreaChartData).gridLines.map((gridLine) => (
                    <g className="token-chart-grid-line" key={gridLine.value}>
                      <line x1={CHART_MARGIN.left} x2={chart.width - CHART_MARGIN.right} y1={gridLine.y} y2={gridLine.y} />
                      <text x={CHART_MARGIN.left - 10} y={gridLine.y + 4}>
                        {formatCompactTokens(gridLine.value)}
                      </text>
                    </g>
                  ))}

                  <line
                    className="token-chart-axis"
                    x1={CHART_MARGIN.left}
                    x2={chart.width - CHART_MARGIN.right}
                    y1={chart.bottom}
                    y2={chart.bottom}
                  />

                  {variant === "area" ? (
                    <>
                      {(chart as AreaChartData).layers.map((layer) => (
                        <path
                          key={layer.key}
                          className={`token-chart-area ${layer.className}`}
                          d={layer.path}
                        >
                          <title>{layer.label}</title>
                        </path>
                      ))}
                      {(chart as AreaChartData).dateLabels.map((dl) => (
                        <text className="token-chart-date-label" key={dl.label} x={dl.x} y={chart.bottom + 24}>
                          {dl.label}
                        </text>
                      ))}
                    </>
                  ) : (
                    (chart as ChartBarData).bars.map((bar) => (
                      <g className="token-chart-bar-group" key={bar.key}>
                        <title>{`${bar.label}: ${formatTokens(bar.total)} ${text?.totalSuffix ?? "total tokens"}`}</title>
                        {bar.segments.map((segment) =>
                          segment.height > 0 ? (
                            <rect
                              className={`token-chart-segment ${segment.className}`}
                              key={segment.key}
                              x={bar.x}
                              y={segment.y}
                              width={bar.width}
                              height={segment.height}
                              rx={4}
                            >
                              <title>{`${bar.label} ${segment.label}: ${formatTokens(segment.value)} ${text?.tokenSuffix ?? "tokens"}`}</title>
                            </rect>
                          ) : null
                        )}
                        <text className="token-chart-date-label" x={bar.centerX} y={chart.bottom + 24}>
                          {bar.label}
                        </text>
                      </g>
                    ))
                  )}

                  {"trendPath" in chart && chart.trendPath ? <path className="token-chart-trend" d={chart.trendPath} /> : null}
                  {variant === "bar" ? (chart as ChartBarData).bars.map((bar) => (
                    <circle className="token-chart-trend-point" key={`${bar.key}-trend`} cx={bar.centerX} cy={bar.trendY} r={3.5}>
                      <title>{`${bar.label} ${text?.trendLabel ?? "trend"}: ${formatTokens(bar.total)} ${text?.tokenSuffix ?? "tokens"}`}</title>
                    </circle>
                  )) : null}
                  {variant === "area" ? (chart as AreaChartData).centerXs.map((cx, i) => (
                    <circle className="token-chart-trend-point" key={`trend-${i}`} cx={cx} cy={(chart as AreaChartData).trendYs[i]} r={3.5}>
                      <title>{`${(chart as AreaChartData).dateLabels[i].label} ${text?.trendLabel ?? "trend"}: ${formatTokens((chart as AreaChartData).maxTotal)} ${text?.tokenSuffix ?? "tokens"}`}</title>
                    </circle>
                  )) : null}
                </svg>
                )}
              </div>

              {variant === "horizon" ? (
                <div className="token-chart-horizon-legend" aria-label={text?.legendAria ?? "Token usage legend"}>
                  <LegendItem className="token-chart-swatch-cached" label={text?.cachedInput ?? "Cached input"} />
                  <LegendItem className="token-chart-swatch-input" label={text?.input ?? "Input"} />
                  <LegendItem className="token-chart-swatch-output" label={text?.output ?? "Output"} />
                  <LegendItem className="token-chart-swatch-reasoning" label={text?.reasoning ?? "Reasoning"} />
                </div>
              ) : (
              <ul className="token-chart-legend" aria-label={text?.legendAria ?? "Token usage legend"}>
                <LegendItem className="token-chart-swatch-cached" label={text?.cachedInput ?? "Cached input"} />
                <LegendItem className="token-chart-swatch-input" label={text?.input ?? "Input"} />
                <LegendItem className="token-chart-swatch-output" label={text?.output ?? "Output"} />
                <LegendItem className="token-chart-swatch-reasoning" label={text?.reasoning ?? "Reasoning"} />
                <LegendItem className="token-chart-swatch-trend" label={text?.totalTrend ?? "Total trend"} />
              </ul>
              )}
            </>
          ) : (
            <div className="token-chart-empty" aria-live="polite">
              {loading ? text?.emptyLoading ?? "Loading daily token usage..." : text?.empty ?? "No daily token usage yet."}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function renderHorizonChart(chart: HorizonChartData, text: TokenChartCopy | undefined, chartTitleId: string) {
  const HORIZON_ROW_HEIGHT = 28;
  const HORIZON_MARGIN_TOP = 8;
  return (
    <svg
      className="token-chart-svg"
      role="img"
      aria-labelledby={chartTitleId}
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      width={chart.width}
      height={chart.height}
    >
      <title id={chartTitleId}>{text?.chartTitle ?? "Daily token usage by date"}</title>
      {chart.rows.map((row, ri) => {
        const rowY = HORIZON_MARGIN_TOP + ri * HORIZON_ROW_HEIGHT;
        return (
          <g className="token-chart-horizon-row" key={row.key} transform={`translate(0, ${rowY})`}>
            <text className="token-chart-horizon-label" x={6} y={HORIZON_ROW_HEIGHT / 2 + 4}>
              {row.label}
            </text>
            {row.bands.map((band, bi) => (
              <path
                key={bi}
                className={`token-chart-horizon-band ${band.className}`}
                d={band.path}
              >
                <title>{`${row.label} band ${bi + 1}`}</title>
              </path>
            ))}
          </g>
        );
      })}
      <line
        className="token-chart-axis"
        x1={72}
        x2={chart.width - 24}
        y1={chart.bottom}
        y2={chart.bottom}
      />
      {chart.dateLabels.map((dl) => (
        <text className="token-chart-date-label" key={dl.label} x={dl.x} y={chart.bottom + 22}>
          {dl.label}
        </text>
      ))}
    </svg>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="token-chart-kpi">
      <span>{label}</span>
      <strong>{formatTokens(value)}</strong>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <li className="token-chart-legend-item">
      <span className={`token-chart-swatch ${className}`} aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

function normalizePoints(data: DailyTokenUsagePanelProps["data"], maxVisiblePoints?: number): DailyTokenUsagePoint[] {
  const points = Array.isArray(data) ? data : data?.points ?? [];
  const normalized = points
    .map((point) => ({
      date: point.date,
      input: positiveNumber(point.input),
      output: positiveNumber(point.output),
      reasoning: positiveNumber(point.reasoning),
      cachedInput: positiveNumber(point.cachedInput),
      total: positiveNumber(point.total)
    }))
    .filter((point) => point.date.trim().length > 0)
    .sort(comparePoints);

  if (maxVisiblePoints === undefined || maxVisiblePoints <= 0) return normalized;
  return normalized.slice(-maxVisiblePoints);
}

function summarizePoints(points: DailyTokenUsagePoint[]) {
  const summary = points.reduce(
    (current, point) => {
      const parts = getTokenParts(point);
      current.total += parts.total;
      current.input += point.input;
      current.output += point.output;
      current.reasoning += point.reasoning;
      current.cachedInput += point.cachedInput;
      return current;
    },
    { total: 0, input: 0, output: 0, reasoning: 0, cachedInput: 0, kvHit: null as number | null }
  );

  summary.kvHit = summary.input > 0 ? clamp(summary.cachedInput / summary.input, 0, 1) : null;
  return summary;
}

function buildChart(points: DailyTokenUsagePoint[], variant: ChartVariant): ChartBarData | AreaChartData | HorizonChartData {
  if (variant === "area") return buildAreaChart(points);
  if (variant === "horizon") return buildHorizonChart(points);
  return buildBarChart(points);
}

function buildBarChart(points: DailyTokenUsagePoint[]): ChartBarData {
  const width = Math.max(MIN_SVG_WIDTH, CHART_MARGIN.left + CHART_MARGIN.right + points.length * POINT_WIDTH);
  const bottom = SVG_HEIGHT - CHART_MARGIN.bottom;
  const innerHeight = bottom - CHART_MARGIN.top;
  const innerWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const pointParts = points.map(getTokenParts);
  const maxTotal = niceCeil(Math.max(1, ...pointParts.map((parts) => parts.total)));
  const step = points.length > 0 ? innerWidth / points.length : innerWidth;
  const barWidth = Math.min(30, Math.max(12, step * 0.54));
  const bars: ChartBar[] = points.map((point, index) => {
    const parts = pointParts[index];
    const centerX = CHART_MARGIN.left + step * index + step / 2;
    const x = centerX - barWidth / 2;
    const trendY = valueToY(parts.total, maxTotal, innerHeight, bottom);
    let segmentBase = bottom;
    const segments = segmentDefinitions(parts).map((segment) => {
      const height = valueToHeight(segment.value, maxTotal, innerHeight);
      segmentBase -= height;
      return {
        ...segment,
        y: segmentBase,
        height
      };
    });

    return {
      key: `${point.date}-${index}`,
      label: formatDateLabel(point.date),
      total: parts.total,
      centerX,
      trendY,
      x,
      y: trendY,
      width: barWidth,
      segments
    };
  });

  const trendPath = buildTrendPath(bars.map((bar) => ({ x: bar.centerX, y: bar.trendY })));
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = maxTotal * ratio;
    return {
      value,
      y: valueToY(value, maxTotal, innerHeight, bottom)
    };
  });

  return {
    width,
    bottom,
    bars,
    trendPath,
    gridLines
  };
}

function buildAreaChart(points: DailyTokenUsagePoint[]): AreaChartData {
  const width = Math.max(MIN_SVG_WIDTH, CHART_MARGIN.left + CHART_MARGIN.right + points.length * POINT_WIDTH);
  const bottom = SVG_HEIGHT - CHART_MARGIN.bottom;
  const innerHeight = bottom - CHART_MARGIN.top;
  const innerWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const pointParts = points.map(getTokenParts);
  const maxTotal = niceCeil(Math.max(1, ...pointParts.map((parts) => parts.total)));
  const step = points.length > 0 ? innerWidth / points.length : innerWidth;

  const xs = points.map((_, index) => CHART_MARGIN.left + step * index + step / 2);
  const dateLabels = points.map((point, index) => ({
    x: xs[index],
    label: formatDateLabel(point.date)
  }));

  // Compute stacked y values for each layer at each point
  const layerKeys = ["cached", "input", "output", "reasoning"] as const;
  const layerClassNames: Record<string, string> = {
    cached: "token-chart-segment-cached",
    input: "token-chart-segment-input",
    output: "token-chart-segment-output",
    reasoning: "token-chart-segment-reasoning"
  };

  // For each layer, compute the top y at each point (stacked from bottom)
  const stackedTops: number[][] = layerKeys.map(() => []);
  for (let i = 0; i < points.length; i++) {
    const parts = pointParts[i];
    let accum = bottom;
    for (const key of layerKeys) {
      const h = valueToHeight(partValue(parts, key), maxTotal, innerHeight);
      accum -= h;
      stackedTops[layerKeys.indexOf(key)][i] = accum;
    }
  }

  // Build area paths for each layer
  const layers: AreaLayer[] = layerKeys.map((key, li) => {
    const tops = stackedTops[li];
    // Base of this layer = top of layer below, or bottom for first layer
    const bases = li === 0
      ? Array(points.length).fill(bottom)
      : stackedTops[li - 1];

    // Build smooth area path: trace top edge forward, then bottom edge backward
    const topPoints = xs.map((x, i) => ({ x, y: tops[i] }));
    const basePoints = xs.map((x, i) => ({ x, y: bases[i] }));

    const topPath = buildTrendPath(topPoints);
    const basePath = buildTrendPath([...basePoints].reverse());

    // Full area path: start at first base point, trace top, end at last base point, trace base back
    const path = `M ${xs[0]} ${bases[0]} ${topPath.slice(1)} L ${xs[xs.length - 1]} ${bases[bases.length - 1]} ${basePath.slice(1)} Z`;

    return {
      key,
      label: key === "cached" ? "cached input" : key,
      className: layerClassNames[key],
      path
    };
  });

  // Trend line
  const trendYs = pointParts.map((parts) => valueToY(parts.total, maxTotal, innerHeight, bottom));
  const trendPath = buildTrendPath(xs.map((x, i) => ({ x, y: trendYs[i] })));

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: maxTotal * ratio,
    y: valueToY(maxTotal * ratio, maxTotal, innerHeight, bottom)
  }));

  return { width, bottom, layers, trendPath, gridLines, centerXs: xs, trendYs, dateLabels, maxTotal };
}

function buildHorizonChart(points: DailyTokenUsagePoint[]): HorizonChartData {
  const HORIZON_ROW_HEIGHT = 28;
  const HORIZON_BANDS = 3;
  const HORIZON_MARGIN = { top: 8, right: 24, bottom: 36, left: 72 };
  const width = Math.max(MIN_SVG_WIDTH, HORIZON_MARGIN.left + HORIZON_MARGIN.right + points.length * POINT_WIDTH);
  const innerWidth = width - HORIZON_MARGIN.left - HORIZON_MARGIN.right;
  const pointParts = points.map(getTokenParts);
  const step = points.length > 0 ? innerWidth / points.length : innerWidth;

  const tokenTypes = [
    { key: "cachedInput", label: "Cached input", className: "token-chart-horizon-cached" },
    { key: "input", label: "Input", className: "token-chart-horizon-input" },
    { key: "output", label: "Output", className: "token-chart-horizon-output" },
    { key: "reasoning", label: "Reasoning", className: "token-chart-horizon-reasoning" }
  ] as const;

  const rows: HorizonRow[] = tokenTypes.map((tt) => {
    const values = pointParts.map((p) => partValue(p, tt.key) ?? 0);
    const rowMax = niceCeil(Math.max(1, ...values));
    const bandSize = rowMax / HORIZON_BANDS;

    const bands: HorizonBand[] = [];
    for (let b = 0; b < HORIZON_BANDS; b++) {
      const bandMin = b * bandSize;
      const bandMax = (b + 1) * bandSize;
      const bandHeight = HORIZON_ROW_HEIGHT / HORIZON_BANDS;

      // Clamp each value to [bandMin, bandMax] range
      const clamped = values.map((v) => Math.max(0, Math.min(v, bandMax) - bandMin));
      const scaled = clamped.map((v) => (v / bandSize) * bandHeight);

      // Build area path for this band — fill from top of band down to scaled value
      const xs = points.map((_, i) => HORIZON_MARGIN.left + step * i + step / 2);
      const bandTop = bandHeight; // top of band (0 = top of row in local coords)
      // We want the area to fill from bandTop (top) down to (bandTop - scaled[i]) (the filled portion)
      const fillYs = scaled.map((s) => bandTop - s);

      // Build smooth path along the fill edge, then back along band top
      const fillPoints = xs.map((x, i) => ({ x, y: fillYs[i] }));
      const fillPath = buildTrendPath(fillPoints);
      const topPath = buildTrendPath(xs.map((x) => ({ x, y: bandTop })).reverse());

      const path = `M ${xs[0]} ${bandTop} ${fillPath.slice(1)} L ${xs[xs.length - 1]} ${bandTop}`;

      bands.push({
        className: `token-chart-horizon-band-${b + 1} token-chart-horizon-${tt.key}`,
        path
      });
    }

    return { key: tt.key, label: tt.label, bands };
  });

  const height = HORIZON_MARGIN.top + HORIZON_MARGIN.bottom + tokenTypes.length * HORIZON_ROW_HEIGHT;
  const bottom = height - HORIZON_MARGIN.bottom;

  const dateLabels = points.map((point, i) => ({
    x: HORIZON_MARGIN.left + step * i + step / 2,
    label: formatDateLabel(point.date)
  }));

  return { width, height, bottom, rows, dateLabels };
}

function partValue(parts: TokenParts, key: string): number {
  switch (key) {
    case "cached": return parts.cachedInput;
    case "cachedInput": return parts.cachedInput;
    case "input": return parts.input;
    case "output": return parts.output;
    case "reasoning": return parts.reasoning;
    case "other": return parts.other;
    case "total": return parts.total;
    default: return 0;
  }
}

function getTokenParts(point: DailyTokenUsagePoint): TokenParts {
  const input = positiveNumber(point.input);
  const cachedInput = Math.min(positiveNumber(point.cachedInput), input);
  const uncachedInput = Math.max(0, input - cachedInput);
  const output = positiveNumber(point.output);
  const reasoning = positiveNumber(point.reasoning);
  const calculatedTotal = input + output + reasoning;
  const total = Math.max(positiveNumber(point.total), calculatedTotal);
  const other = Math.max(0, total - calculatedTotal);

  return {
    cachedInput,
    input: uncachedInput,
    output,
    reasoning,
    other,
    total
  };
}

function segmentDefinitions(parts: TokenParts): Omit<ChartSegment, "y" | "height">[] {
  return [
    {
      key: "cached",
      label: "cached input",
      value: parts.cachedInput,
      className: "token-chart-segment-cached"
    },
    {
      key: "input",
      label: "input",
      value: parts.input,
      className: "token-chart-segment-input"
    },
    {
      key: "output",
      label: "output",
      value: parts.output,
      className: "token-chart-segment-output"
    },
    {
      key: "reasoning",
      label: "reasoning",
      value: parts.reasoning,
      className: "token-chart-segment-reasoning"
    },
    {
      key: "other",
      label: "other",
      value: parts.other,
      className: "token-chart-segment-other"
    }
  ];
}

function buildTrendPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    commands.push(`Q ${current.x} ${current.y} ${midX} ${midY}`);
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  commands.push(`Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`);
  return commands.join(" ");
}

function valueToHeight(value: number, maxTotal: number, innerHeight: number) {
  return (positiveNumber(value) / maxTotal) * innerHeight;
}

function valueToY(value: number, maxTotal: number, innerHeight: number, bottom: number) {
  return bottom - valueToHeight(value, maxTotal, innerHeight);
}

function positiveNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function comparePoints(first: DailyTokenUsagePoint, second: DailyTokenUsagePoint) {
  const firstTime = parseDateTime(first.date);
  const secondTime = parseDateTime(second.date);
  if (firstTime !== null && secondTime !== null) return firstTime - secondTime;
  if (firstTime !== null) return -1;
  if (secondTime !== null) return 1;
  return first.date.localeCompare(second.date);
}

function parseDateTime(value: string) {
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(time) ? null : time;
}

function formatDateLabel(value: string) {
  const time = parseDateTime(value);
  if (time === null) return value;
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(time);
}

function formatTokens(value: number) {
  return formatMillionTokens(positiveNumber(value));
}

function formatCompactTokens(value: number) {
  return formatMillionTokens(positiveNumber(value));
}

function formatKvHit(value: number | null) {
  return value === null ? "n/a" : PERCENT_FORMATTER.format(value);
}

function niceCeil(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}
