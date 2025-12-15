# @writers-block/logger

`@writers-block/logger` centralises workspace logging concerns behind a small wrapper on top of the Node.js console APIs. The helper exposes structured log methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) that respect a shared runtime-configurable log level. Consumers can opt into verbose diagnostics for troubleshooting while keeping production output quiet by default.

## Why not add a third-party logger?

We evaluated popular Node.js logging packages (e.g. Pino, Winston) but kept the bespoke wrapper for now because:

- **Operational simplicity** – the workspace already depends on the platform console. A minimal adapter avoids introducing new transports, configuration files, or peer dependencies that every package must wire up.
- **Build footprint** – third-party loggers typically pull in JSON serializers and stream helpers that increase bundle size. The current needs focus on toggling verbosity rather than structured shipping or log shipping pipelines.
- **Type safety and flexibility** – the in-house wrapper still exposes strongly-typed helpers and allows swapping emitters later. The shared toggle, namespaces, and log levels can be re-routed to another backend without refactoring call sites.

If future requirements include log shipping, redaction, or asynchronous transports, the wrapper can redirect to a dedicated logging backend while keeping the existing API intact.

## Runtime configuration

`@writers-block/logger` ships with a safe default log level of `INFO`. Consumers are responsible for deciding how configuration enters their process (environment variables, config files, CLI flags, etc.) and should call `setLogLevel` accordingly. Setting a level below `INFO` (for example `DEBUG` or `TRACE`) enables verbose output, while raising the level to `WARN` or above suppresses lower-importance events.

For example, an API package can hydrate the logger from its own environment management:

```ts
import { setLogLevel, type LogLevel } from '@writers-block/logger';

const envLogLevel = process.env.LOG_LEVEL?.toUpperCase();
const validLevels: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const isLogLevel = (value: string): value is LogLevel =>
  (validLevels as readonly string[]).includes(value);

if (envLogLevel && isLogLevel(envLogLevel)) {
  setLogLevel(envLogLevel);
}
```
