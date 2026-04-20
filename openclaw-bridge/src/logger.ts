export function createLogger(prefix: string) {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[${prefix}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${prefix}] ${msg}`, ...args),
    debug: (msg: string, ...args: unknown[]) => {
      if (process.env.DEBUG) console.log(`[${prefix}:debug] ${msg}`, ...args);
    },
  };
}
