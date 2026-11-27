import { config } from '../config';

/** Small structured (JSON lines) logger. No dependency, safe to ship to any log collector. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

const threshold = LEVELS[(config.logLevel as keyof typeof LEVELS) in LEVELS ? (config.logLevel as keyof typeof LEVELS) : 'info'];

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < threshold) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

export const logger = {
    debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
    info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
