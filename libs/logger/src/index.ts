export type LogContext = Record<string, unknown>;

export type LogLevel =
  | 'TRACE'
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'FATAL';

export interface Logger {
  readonly trace: (message: string, context?: LogContext) => void;
  readonly debug: (message: string, context?: LogContext) => void;
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, context?: LogContext) => void;
  readonly fatal: (message: string, context?: LogContext) => void;
}

const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
};

let currentLogLevel: LogLevel = 'INFO';

export const getLogLevel = (): LogLevel => currentLogLevel;

export const setLogLevel = (level: LogLevel): void => {
  currentLogLevel = level;
};

const formatMessage = (namespace: string | undefined, message: string): string =>
  namespace ? `[${namespace}] ${message}` : message;

const callConsole = (
  method: keyof Console,
  fallback: keyof Console,
  message: string,
  context?: LogContext,
): void => {
  const toCallable = (value: unknown): ((...args: unknown[]) => void) | undefined =>
    typeof value === 'function' ? (value as (...args: unknown[]) => void) : undefined;

  const candidate = toCallable(console[method as keyof Console]);
  const fallbackFn = toCallable(console[fallback as keyof Console]);
  const invoker = (candidate ?? fallbackFn ?? console.log.bind(console)) as (
    ...args: unknown[]
  ) => void;

  if (context !== undefined) {
    invoker(message, context);
  } else {
    invoker(message);
  }
};

const emit = (level: LogLevel, message: string, context?: LogContext): void => {
  switch (level) {
    case 'TRACE': {
      callConsole('trace', 'log', message, context);
      break;
    }
    case 'DEBUG': {
      callConsole('debug', 'log', message, context);
      break;
    }
    case 'INFO': {
      callConsole('info', 'log', message, context);
      break;
    }
    case 'WARN': {
      callConsole('warn', 'error', message, context);
      break;
    }
    case 'ERROR':
    case 'FATAL': {
      callConsole('error', 'log', message, context);
      break;
    }
    default: {
      const exhaustive: never = level;
      throw new Error(`Unsupported log level: ${exhaustive}`);
    }
  }
};

const shouldEmit = (level: LogLevel): boolean => {
  const weight = LOG_LEVEL_WEIGHTS[level];
  const threshold = LOG_LEVEL_WEIGHTS[currentLogLevel];

  if (weight < threshold) {
    return false;
  }

  return true;
};

const createLevelLogger = (
  namespace: string | undefined,
  level: LogLevel,
): ((message: string, context?: LogContext) => void) => (message, context) => {
  if (!shouldEmit(level)) {
    return;
  }

  emit(level, formatMessage(namespace, message), context);
};

export const createLogger = (namespace?: string): Logger => ({
  trace: createLevelLogger(namespace, 'TRACE'),
  debug: createLevelLogger(namespace, 'DEBUG'),
  info: createLevelLogger(namespace, 'INFO'),
  warn: createLevelLogger(namespace, 'WARN'),
  error: createLevelLogger(namespace, 'ERROR'),
  fatal: createLevelLogger(namespace, 'FATAL'),
});
