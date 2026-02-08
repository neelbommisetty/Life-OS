const LOG_LEVEL_WEIGHTS = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
};

let currentLogLevel = "INFO";

export const getLogLevel = () => currentLogLevel;

export const setLogLevel = (level) => {
  currentLogLevel = level;
};

const formatMessage = (namespace, message) =>
  namespace ? `[${namespace}] ${message}` : message;

const callConsole = (method, fallback, message, context) => {
  const toCallable = (value) => (typeof value === "function" ? value : undefined);
  const candidate = toCallable(console[method]);
  const fallbackFn = toCallable(console[fallback]);
  const invoker = candidate ?? fallbackFn ?? console.log.bind(console);

  if (context !== undefined) {
    invoker(message, context);
    return;
  }

  invoker(message);
};

const emit = (level, message, context) => {
  switch (level) {
    case "TRACE": {
      callConsole("trace", "log", message, context);
      break;
    }
    case "DEBUG": {
      callConsole("debug", "log", message, context);
      break;
    }
    case "INFO": {
      callConsole("info", "log", message, context);
      break;
    }
    case "WARN": {
      callConsole("warn", "error", message, context);
      break;
    }
    case "ERROR":
    case "FATAL": {
      callConsole("error", "log", message, context);
      break;
    }
    default: {
      throw new Error(`Unsupported log level: ${level}`);
    }
  }
};

const shouldEmit = (level) => {
  const weight = LOG_LEVEL_WEIGHTS[level];
  const threshold = LOG_LEVEL_WEIGHTS[currentLogLevel];
  return weight >= threshold;
};

const createLevelLogger = (namespace, level) => (message, context) => {
  if (!shouldEmit(level)) {
    return;
  }

  emit(level, formatMessage(namespace, message), context);
};

export const createLogger = (namespace) => ({
  trace: createLevelLogger(namespace, "TRACE"),
  debug: createLevelLogger(namespace, "DEBUG"),
  info: createLevelLogger(namespace, "INFO"),
  warn: createLevelLogger(namespace, "WARN"),
  error: createLevelLogger(namespace, "ERROR"),
  fatal: createLevelLogger(namespace, "FATAL"),
});
