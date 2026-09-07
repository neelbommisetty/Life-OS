"use client";

import { useEffect, useRef, useState } from "react";
import type { Metric, Observation } from "@/lib/contract";
import { displayDate } from "@/lib/selectors";

export function MeasurementChart({
  metric,
  observations,
}: {
  metric: Metric;
  observations: Observation[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!observations.length)
    return <p className="muted">No measurements in this period.</p>;
  const left = 60,
    right = width - 18,
    top = 30,
    bottom = 160;
  const values = observations.map((item) => item.value);
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.28, Math.abs(max) * 0.005, 0.1);
  const low = metric.style === "bars" ? Math.min(0, min) : min - padding;
  const high = metric.style === "bars" ? Math.max(1, max * 1.1) : max + padding;
  const y = (v: number) => bottom - ((v - low) / (high - low)) * (bottom - top);
  const first = Date.parse(observations[0].date),
    last = Date.parse(observations.at(-1)!.date);
  const range = Math.max(last - first, 86400000);
  const x = (date: string) =>
    left + 13 + ((Date.parse(date) - first) / range) * (right - left - 26);
  const ticks =
    observations.length > 3
      ? [0, Math.floor((observations.length - 1) / 2), observations.length - 1]
      : [0, observations.length - 1];
  const barWidth = Math.max(
    2,
    Math.min(
      20,
      ((right - left) / Math.max((last - first) / 86400000 + 1, 1)) * 0.52,
    ),
  );
  return (
    <div className="measurement-chart" ref={container}>
      <svg
        viewBox={`0 0 ${width} 206`}
        width={width}
        height={206}
        role="img"
        aria-label={`${metric.label}, ${observations.length} dated readings. Exact values are in the readings table.`}
      >
        <text x={left} y={16} className="axis-title">
          {metric.unit}
        </text>
        <rect
          x={left}
          y={top}
          width={right - left}
          height={bottom - top}
          className="plot-frame"
        />
        {[low, (low + high) / 2, high].map((tick, i) => (
          <g key={i}>
            {i === 1 ? (
              <line
                x1={left}
                x2={right}
                y1={y(tick)}
                y2={y(tick)}
                className="plot-grid"
              />
            ) : null}
            <text x={left - 9} y={y(tick) + 4} textAnchor="end">
              {tick.toFixed(metric.precision > 0 ? 1 : 0)}
            </text>
          </g>
        ))}
        {observations.map((point, index) =>
          metric.style === "bars" ? (
            <rect
              key={point.id}
              x={x(point.date) - barWidth / 2}
              y={Math.min(y(point.value), y(0))}
              width={barWidth}
              height={Math.abs(y(0) - y(point.value))}
              rx={2}
              className={
                index === observations.length - 1 ? "mark latest" : "mark"
              }
            >
              <title>
                {`${displayDate(point.date)}: ${point.value.toFixed(metric.precision)} ${metric.unit}`}
              </title>
            </rect>
          ) : (
            <g key={point.id}>
              <circle
                cx={x(point.date)}
                cy={y(point.value)}
                r={5}
                className="point"
              >
                <title>
                  {`${displayDate(point.date)}: ${point.value.toFixed(metric.precision)} ${metric.unit}`}
                </title>
              </circle>
              <text
                x={x(point.date)}
                y={y(point.value) - 12}
                textAnchor={index === observations.length - 1 ? "end" : "start"}
                className="value-label"
              >
                {point.value.toFixed(metric.precision)}
              </text>
            </g>
          ),
        )}
        {[...new Set(ticks)].map((index, i, array) => (
          <text
            key={index}
            x={x(observations[index].date)}
            y={181}
            textAnchor={
              i === 0 ? "start" : i === array.length - 1 ? "end" : "middle"
            }
          >
            {displayDate(observations[index].date)}
          </text>
        ))}
        <text
          x={(left + right) / 2}
          y={202}
          textAnchor="middle"
          className="axis-title"
        >
          Measurement date
        </text>
      </svg>
    </div>
  );
}
