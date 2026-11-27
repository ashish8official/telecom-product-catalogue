import path from 'path';
import dotenv from 'dotenv';
import type { PoolConfig } from 'pg';

// Load backend/.env regardless of the directory the process was started from.
dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')],
    quiet: true,
});

export type ApiRole = 'admin' | 'reader';

export interface ApiKeyEntry {
    tenantId: string;
    role: ApiRole;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * API_KEYS format: "<key>:<tenant uuid>:<admin|reader>" entries separated by ";" or ",".
 * When no keys are configured the API runs in open development mode and trusts the
 * x-tenant-id header. That mode is refused when NODE_ENV=production.
 */
function parseApiKeys(raw: string | undefined): Map<string, ApiKeyEntry> {
    const keys = new Map<string, ApiKeyEntry>();
    if (!raw) return keys;
    for (const entry of raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
        const [key, tenantId, role = 'admin'] = entry.split(':').map((s) => s.trim());
        if (!key || key.length < 16) throw new Error('API_KEYS: every key must be at least 16 characters long');
        if (!tenantId || !UUID_RE.test(tenantId)) throw new Error('API_KEYS: every entry needs a tenant UUID');
        if (role !== 'admin' && role !== 'reader') throw new Error('API_KEYS: role must be "admin" or "reader"');
        keys.set(key, { tenantId: tenantId.toLowerCase(), role });
    }
    return keys;
}

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';

function intFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer`);
    return parsed;
}

function buildDbConfig(): { poolConfig: PoolConfig; database: string } {
    const common: PoolConfig = {
        max: intFromEnv('PGPOOL_MAX', 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        statement_timeout: intFromEnv('PG_STATEMENT_TIMEOUT_MS', 30_000),
        application_name: 'product-catalogue',
    };

    // Tests always run against a dedicated database so they can never touch real catalogue data.
    const url = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
    if (url) {
        const database = new URL(url).pathname.replace(/^\//, '');
        return { poolConfig: { ...common, connectionString: url }, database };
    }

    const database = isTest
        ? process.env.PGDATABASE_TEST || 'catalogue_test'
        : process.env.PGDATABASE || 'catalogue_db';

    return {
        database,
        poolConfig: {
            ...common,
            host: process.env.PGHOST || 'localhost',
            port: intFromEnv('PGPORT', 5433),
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD,
            database,
        },
    };
}

const db = buildDbConfig();
const apiKeys = parseApiKeys(process.env.API_KEYS);

if (env === 'production' && apiKeys.size === 0) {
    throw new Error('API_KEYS must be configured when NODE_ENV=production (open tenant-header mode is development only)');
}

export const config = {
    env,
    isTest,
    isProduction: env === 'production',
    port: intFromEnv('PORT', 8080),
    /** Optional externally visible base URL used for TMF620 href values. Derived from the request when unset. */
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '') || null,
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    logLevel: (process.env.LOG_LEVEL || (isTest ? 'silent' : 'info')).toLowerCase(),
    apiKeys,
    db,
    paths: {
        migrations: path.join(__dirname, '..', 'database', 'migrations'),
        seeds: path.join(__dirname, '..', 'database', 'seeds'),
        sqlTests: path.join(__dirname, '..', 'database', 'tests'),
        frontend: path.join(__dirname, '..', 'frontend'),
    },
};

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
