"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeData, Block, EvidenceRecord } from "@/lib/contract";
import {
  displayDate,
  displayChecked,
  displayEventTime,
  focusFreshness,
  observationsFor,
  operationalRecords,
} from "@/lib/selectors";
import { MeasurementChart } from "./measurement-chart";
import { RefreshData } from "./refresh-data";

type Props = {
  data: HomeData;
  page: "home" | "health";
  view: "perspective" | "plan";
  focusId?: string;
  now: string;
};

export function LifeHome({ data, page, view, focusId, now }: Props) {
  const router = useRouter();
  const focus =
    data.focuses.find((item) => item.id === focusId) ??
    data.focuses.find((item) => item.id === data.activeFocusId)!;
  const preview = focus.id !== data.activeFocusId;
  const records = new Map(data.records.map((record) => [record.id, record]));
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  const direction = records.get(focus.directionId)!;
  const ops = operationalRecords(data, now);
  const nextEvent = ops.events[0];
  const freshness = focusFreshness(data, focus, now);
  const path = page === "health" ? "/health" : "/";
  const url = (
    nextPage = page,
    nextView = view,
    nextFocus: string | null | undefined = focusId,
  ) => {
    const params = new URLSearchParams();
    if (nextView === "plan") params.set("view", "plan");
    if (nextFocus) params.set("focus", nextFocus);
    return (
      (nextPage === "health" ? "/health" : "/") +
      (params.size ? "?" + params.toString() : "")
    );
  };
  const sourceLine = (record: EvidenceRecord) => (
    <span className="source-line">
      {sources.get(record.sourceId)?.label} · Checked{" "}
      {displayChecked(sources.get(record.sourceId)!.checkedAt)} PT
    </span>
  );
  function renderBlock(block: Block, index: number) {
    if (block.type === "metric") {
      const metric = data.metrics.find((item) => item.id === block.metricId)!;
      const observations = observationsFor(data, block);
      const latest = observations.at(-1);
      return (
        <section className="section" key={index} aria-label={metric.label}>
          <div className="section-heading">
            <h3>{metric.label}</h3>
            {latest ? (
              <span className="metric-value">
                {latest.value.toFixed(metric.precision)}{" "}
                <small>{metric.unit}</small>
              </span>
            ) : null}
          </div>
          {latest ? (
            <p className="date-line">
              Latest measured {displayDate(latest.date)}
            </p>
          ) : null}
          <MeasurementChart metric={metric} observations={observations} />
          <p className="date-line">{block.note}</p>
          <details>
            <summary>Readings &amp; coverage</summary>
            {observations.length ? (
              <table>
                <caption className="sr-only">{metric.label} readings</caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>{metric.unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((item) => (
                    <tr key={item.id}>
                      <td>{displayDate(item.date)}</td>
                      <td>{item.value.toFixed(metric.precision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {[...new Set(observations.map((item) => item.sourceId))].map(
              (id) => (
                <p className="date-line" key={id}>
                  {sources.get(id)!.label}: {sources.get(id)!.coverage} Checked{" "}
                  {displayChecked(sources.get(id)!.checkedAt)} PT.
                </p>
              ),
            )}
          </details>
        </section>
      );
    }
    if (block.type === "timeline")
      return (
        <section className="section" key={index}>
          <p className="kicker">Where you were</p>
          <dl className="timeline">
            {block.recordIds.map((id) => {
              const record = records.get(id)!;
              return record.kind === "reflection" ? (
                <div key={id}>
                  <dt>{displayDate(record.date)}</dt>
                  <dd>{record.text}</dd>
                </div>
              ) : null;
            })}
          </dl>
          <p className="recognition">
            {freshness.evidenceChanged
              ? "The supporting notes have changed. Review the earlier interpretation before relying on it."
              : focus.recognition}
          </p>
        </section>
      );
    const record = records.get(block.recordId)!;
    return record.kind === "reflection" ? (
      <section className="section" key={index}>
        <p className="kicker">
          {record.wording === "direct" ? "In your words" : "From your notes"}
        </p>
        <blockquote>
          {record.wording === "direct" ? `“${record.text}”` : record.text}
        </blockquote>
        <p className="date-line">
          {displayDate(record.date)} ·{" "}
          {record.wording === "direct" ? "Direct report" : "Summary"}
        </p>
        {sourceLine(record)}
      </section>
    ) : null;
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="wordmark">
          LIFE / OS
        </Link>
        <nav aria-label="Pages">
          <Link
            href={url("home")}
            aria-current={page === "home" ? "page" : undefined}
          >
            Home
          </Link>
          <Link
            href={url("health")}
            aria-current={page === "health" ? "page" : undefined}
          >
            Health
          </Link>
        </nav>
      </header>
      <div className="focus-picker">
        <label htmlFor="focus">
          {preview ? "Preview focus" : "Considered focus"}
        </label>
        <select
          id="focus"
          value={focus.id}
          onChange={(event) =>
            router.push(
              url(
                page,
                view,
                event.target.value === data.activeFocusId
                  ? null
                  : event.target.value,
              ),
            )
          }
        >
          {data.focuses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <nav className="mode-nav" aria-label="Homepage views">
        <Link
          href={url(page, "perspective")}
          aria-current={view === "perspective" ? "page" : undefined}
        >
          Perspective
        </Link>
        <Link
          href={url(page, "plan")}
          aria-current={view === "plan" ? "page" : undefined}
        >
          Plan
        </Link>
      </nav>
      <main>
        {preview ? (
          <p className="notice">
            Exploring another emphasis. Your published focus is unchanged.{" "}
            <Link href={path + (view === "plan" ? "?view=plan" : "")}>
              Return to it
            </Link>
          </p>
        ) : null}
        {view === "perspective" ? (
          <>
            <Link href={url(page, "plan")} className="commitment-strip">
              <span>
                <strong>
                  {nextEvent
                    ? `${displayDate(nextEvent.start)} · ${nextEvent.title}`
                    : "Your Health plan"}
                </strong>
                <small>
                  {nextEvent
                    ? displayEventTime(nextEvent)
                    : "No upcoming event in the available snapshot"}{" "}
                  · {ops.tasks.length} open tasks
                </small>
              </span>
              <span aria-hidden="true">Plan →</span>
            </Link>
            <section className="direction">
              <p className="kicker">
                {page === "home"
                  ? "Health · Your direction"
                  : "Where you want to be"}
              </p>
              <h1>{focus.title}</h1>
              <p className="deck">
                {direction.kind === "intention" ? direction.text : ""}
              </p>
              <details>
                <summary>Why this emphasis?</summary>
                <p>{focus.why}</p>
                <p className="date-line">
                  {focus.basis === "suggested"
                    ? "Suggested from your evidence"
                    : "Explicitly stated direction"}{" "}
                  · Considered {displayChecked(focus.consideredAt)} PT
                </p>
              </details>
            </section>
            {freshness.evidenceChanged || freshness.reviewDue ? (
              <p className="notice" role="status">
                {freshness.evidenceChanged
                  ? "Supporting evidence changed. This perspective needs review."
                  : "This perspective is due for review."}{" "}
                Tasks and calendar records remain separate.
              </p>
            ) : null}
            <section className="section">
              <p className="kicker">
                {freshness.evidenceChanged
                  ? "Earlier assessment"
                  : "Where you are"}
              </p>
              <p className="assessment">{focus.assessment}</p>
              <p className="date-line">
                Based on your account through{" "}
                {displayDate(focus.assessmentDate)}
              </p>
            </section>
            {page === "health" ? (
              focus.blocks.map(renderBlock)
            ) : (
              <Link className="full-link" href={url("health")}>
                Explore Health <span aria-hidden="true">→</span>
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="kicker">
              {page === "home" ? "Your plan · Health slice" : "Health · Plan"}
            </p>
            <h1>What’s on your calendar. What’s still open.</h1>
            <p className="deck">
              Your commitments, independent of the current focus.
            </p>
            <section className="section">
              <h2>Upcoming</h2>
              {ops.events.length ? (
                ops.events.map((event) => (
                  <article className="event" key={event.id}>
                    <div className="event-date">
                      <span>
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "short",
                          timeZone: event.timezone,
                        }).format(new Date(event.start))}
                      </span>
                      <strong>
                        {new Intl.DateTimeFormat("en-US", {
                          day: "numeric",
                          timeZone: event.timezone,
                        }).format(new Date(event.start))}
                      </strong>
                    </div>
                    <div>
                      <h3>{event.title}</h3>
                      <p>{displayEventTime(event)}</p>
                      <p className="date-line">
                        {event.location} · {event.status}
                      </p>
                      {sourceLine(event)}
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted">
                  No upcoming events in the available snapshot. Check source
                  coverage below.
                </p>
              )}
            </section>
            {["dated", "undated"].map((group) => (
              <section className="section" key={group}>
                <h2>{group === "dated" ? "Dated tasks" : "Without a date"}</h2>
                {ops.tasks
                  .filter((task) =>
                    group === "dated" ? task.dueDate : !task.dueDate,
                  )
                  .map((task) => (
                    <details className="task" key={task.id}>
                      <summary>
                        {task.title}
                        <span className="date-line">
                          {task.dueDate
                            ? `Due ${displayDate(task.dueDate)}`
                            : "No date set"}{" "}
                          · Open
                        </span>
                      </summary>
                      <p>{task.context}</p>
                      {sourceLine(task)}
                    </details>
                  ))}
              </section>
            ))}
            {!ops.tasks.length ? (
              <p className="muted">No open tasks in the available snapshot.</p>
            ) : null}
            <p className="date-line section">
              An open task is its source status, not proof that an activity did
              not happen. This app does not complete tasks or change bookings.
            </p>
          </>
        )}
        <details className="section coverage">
          <summary>Sources &amp; freshness</summary>
          {data.sources.map((source) => (
            <div key={source.id}>
              <h3>{source.label}</h3>
              <p className="date-line">
                {source.state} · Checked {displayChecked(source.checkedAt)} PT
              </p>
              <p>{source.coverage}</p>
            </div>
          ))}
        </details>
      </main>
      <footer>
        <div>
          <span className="local-dot" aria-hidden="true" /> Local app ·
          Read-only snapshots
        </div>
        <p>
          Data published {displayChecked(data.publishedAt)} PT. Source dates
          remain separate.
        </p>
        <RefreshData />
      </footer>
    </div>
  );
}
