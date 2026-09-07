import { LifeHome } from "./life-home";
import { RefreshData } from "./refresh-data";
import { readDataFile } from "@/lib/data-file";
import { isLocalRequest } from "@/lib/local-access";

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function HomePage({
  page,
  searchParams,
}: {
  page: "home" | "health";
  searchParams: SearchParams;
}) {
  if (!(await isLocalRequest()))
    return (
      <main className="app-shell error-state">
        <h1>This app runs locally.</h1>
        <p>Open it using its localhost address.</p>
      </main>
    );
  const [result, params] = await Promise.all([readDataFile(), searchParams]);
  if (!result.ok)
    return (
      <main className="app-shell error-state">
        <p className="wordmark">LIFE / OS</p>
        <h1>
          {result.reason === "missing"
            ? "Your data file is not here yet."
            : "Your data could not be loaded."}
        </h1>
        <p>
          {result.reason === "invalid"
            ? "The local file failed validation. Correct it and refresh to try again."
            : "Follow the local setup guide in this repository, then refresh this page."}
        </p>
        <p className="muted">
          Unavailable data is not a zero or an empty plan.
        </p>
        {result.issues.length > 0 ? (
          <details>
            <summary>Validation details</summary>
            <ul>
              {result.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <RefreshData />
      </main>
    );
  return (
    <LifeHome
      key={result.digest}
      data={result.data}
      page={page}
      view={params.view === "plan" ? "plan" : "perspective"}
      focusId={typeof params.focus === "string" ? params.focus : undefined}
      now={new Date().toISOString()}
    />
  );
}
