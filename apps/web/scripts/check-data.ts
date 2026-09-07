import { readDataFile } from "../src/lib/data-file";

const result = await readDataFile(process.argv[2]);
if (!result.ok) {
  console.error(`Data check failed (${result.reason}).`);
  for (const issue of result.issues) console.error(issue);
  process.exitCode = 1;
} else {
  console.log(
    `Valid: ${result.data.records.length} records, ${result.data.focuses.length} focus plans, revision ${result.data.revision}.`,
  );
}
