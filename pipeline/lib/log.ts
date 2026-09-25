export interface BuildLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  warnings: string[];
}

export function createBuildLog(source: string): BuildLog {
  const warnings: string[] = [];
  const line = (level: string, msg: string) => console.error(`[${source}] ${level} ${msg}`);
  return {
    info: (m) => line('INFO', m),
    warn: (m) => {
      warnings.push(`${source}: ${m}`);
      line('WARN', m);
    },
    error: (m) => line('ERROR', m),
    warnings,
  };
}
