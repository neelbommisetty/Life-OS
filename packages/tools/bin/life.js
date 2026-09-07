#!/usr/bin/env node
// Life-OS tools CLI. Node 26 strips TypeScript types natively; no loader needed.
const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2));
