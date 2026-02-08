export type LogContext = Record<string, unknown>;

export type LogLevel =
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL";

export interface Logger {
  readonly trace: (message: string, context?: LogContext) => void;
  readonly debug: (message: string, context?: LogContext) => void;
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, context?: LogContext) => void;
  readonly fatal: (message: string, context?: LogContext) => void;
}

export declare const getLogLevel: () => LogLevel;
export declare const setLogLevel: (level: LogLevel) => void;
export declare const createLogger: (namespace?: string) => Logger;
