export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface Logger {
  level: LogLevel;
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
  child(prefix: string): Logger;
}

/**
 * All logging goes to stderr. Stdout is the MCP stdio channel and must stay clean.
 */
export function createLogger(level: LogLevel = 'info', prefix = 'fpv-airspace'): Logger {
  const emit = (lvl: LogLevel, msg: string, rest: unknown[]) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const line = `[${prefix}] ${lvl.toUpperCase()} ${msg}`;
    if (rest.length > 0) {
      console.error(line, ...rest);
    } else {
      console.error(line);
    }
  };
  return {
    level,
    debug: (m, ...r) => emit('debug', m, r),
    info: (m, ...r) => emit('info', m, r),
    warn: (m, ...r) => emit('warn', m, r),
    error: (m, ...r) => emit('error', m, r),
    child: (p) => createLogger(level, `${prefix}:${p}`),
  };
}

export const silentLogger: Logger = createLogger('silent');
