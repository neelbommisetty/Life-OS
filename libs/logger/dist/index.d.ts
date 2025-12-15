type LogContext = Record<string, unknown>;
type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
interface Logger {
    readonly trace: (message: string, context?: LogContext) => void;
    readonly debug: (message: string, context?: LogContext) => void;
    readonly info: (message: string, context?: LogContext) => void;
    readonly warn: (message: string, context?: LogContext) => void;
    readonly error: (message: string, context?: LogContext) => void;
    readonly fatal: (message: string, context?: LogContext) => void;
}
declare const getLogLevel: () => LogLevel;
declare const setLogLevel: (level: LogLevel) => void;
declare const createLogger: (namespace?: string) => Logger;

export { createLogger, getLogLevel, setLogLevel };
export type { LogContext, LogLevel, Logger };
