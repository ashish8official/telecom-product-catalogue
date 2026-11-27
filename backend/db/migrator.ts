import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client, ClientConfig } from 'pg';
import { config } from '../config';

/**
 * Minimal, dependency-free SQL migration runner.
 *
 * Files live in database/migrations as NNN_name.up.sql / NNN_name.down.sql. Every migration runs
 * in its own transaction, is recorded in schema_migrations with a checksum, and a session-level
 * advisory lock stops two runners from migrating the same database at once.
 */

export interface MigrationFile {
    version: string;
    name: string;
    upPath: string;
    downPath: string | null;
    checksum: string;
}

export interface AppliedMigration {
    version: string;
    name: string;
    checksum: string;
    applied_at: Date;
}

type Log = (message: string) => void;

const LOCK_KEY = 620_620_620;
const FILE_RE = /^(\d{3})_(.+)\.up\.sql$/;

export function loadMigrations(dir: string = config.paths.migrations): MigrationFile[] {
    return fs
        .readdirSync(dir)
        .map((file) => {
            const match = FILE_RE.exec(file);
            if (!match) return null;
            const upPath = path.join(dir, file);
            const downPath = path.join(dir, `${match[1]}_${match[2]}.down.sql`);
            return {
                version: match[1],
                name: match[2],
                upPath,
                downPath: fs.existsSync(downPath) ? downPath : null,
                checksum: crypto.createHash('sha256').update(fs.readFileSync(upPath)).digest('hex'),
            };
        })
        .filter((m): m is MigrationFile => m !== null)
        .sort((a, b) => a.version.localeCompare(b.version));
}

async function ensureTable(client: Client): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    VARCHAR(10) PRIMARY KEY,
            name       VARCHAR(255) NOT NULL,
            checksum   CHAR(64) NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
}

export async function appliedMigrations(client: Client): Promise<AppliedMigration[]> {
    await ensureTable(client);
    const res = await client.query<AppliedMigration>(
        'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
    );
    return res.rows;
}

async function withLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
        return await fn();
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
}

async function hasUntrackedSchema(client: Client): Promise<boolean> {
    const res = await client.query(`SELECT to_regclass('public.catalogue') IS NOT NULL AS present`);
    return res.rows[0].present;
}

/** Applies every pending migration (optionally stopping at `to`). Returns the versions applied. */
export async function migrateUp(client: Client, opts: { to?: string; log?: Log } = {}): Promise<string[]> {
    const log = opts.log || (() => undefined);
    return withLock(client, async () => {
        const applied = await appliedMigrations(client);
        const files = loadMigrations();

        if (applied.length === 0 && (await hasUntrackedSchema(client))) {
            throw new Error(
                'This database already contains catalogue tables but has no migration history. ' +
                    'Run "npm run db:baseline -- <last applied version>" once, then migrate again.'
            );
        }

        const byVersion = new Map(files.map((f) => [f.version, f]));
        for (const row of applied) {
            const file = byVersion.get(row.version);
            if (file && file.checksum !== row.checksum.trim()) {
                log(`warning: migration ${row.version}_${row.name} was edited after it was applied`);
            }
        }

        const done: string[] = [];
        const appliedSet = new Set(applied.map((a) => a.version));
        for (const file of files) {
            if (appliedSet.has(file.version)) continue;
            if (opts.to && file.version > opts.to) break;
            await client.query('BEGIN');
            try {
                await client.query(fs.readFileSync(file.upPath, 'utf8'));
                await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
                    file.version,
                    file.name,
                    file.checksum,
                ]);
                await client.query('COMMIT');
            } catch (err: any) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${file.version}_${file.name} failed: ${err.message}`);
            }
            log(`applied   ${file.version}_${file.name}`);
            done.push(file.version);
        }
        return done;
    });
}

/** Rolls back the most recent `steps` migrations. Returns the versions reverted. */
export async function migrateDown(client: Client, steps = 1, log: Log = () => undefined): Promise<string[]> {
    return withLock(client, async () => {
        const applied = (await appliedMigrations(client)).reverse().slice(0, steps);
        const byVersion = new Map(loadMigrations().map((f) => [f.version, f]));
        const done: string[] = [];
        for (const row of applied) {
            const file = byVersion.get(row.version);
            if (!file || !file.downPath) {
                throw new Error(`No rollback file found for migration ${row.version}_${row.name}`);
            }
            await client.query('BEGIN');
            try {
                await client.query(fs.readFileSync(file.downPath, 'utf8'));
                await client.query('DELETE FROM schema_migrations WHERE version = $1', [row.version]);
                await client.query('COMMIT');
            } catch (err: any) {
                await client.query('ROLLBACK');
                throw new Error(`Rollback of ${row.version}_${row.name} failed: ${err.message}`);
            }
            log(`reverted  ${row.version}_${row.name}`);
            done.push(row.version);
        }
        return done;
    });
}

/**
 * Records migrations up to and including `toVersion` as already applied without running them.
 * Used once for databases that were created by hand before the runner existed.
 */
export async function baseline(client: Client, toVersion: string, log: Log = () => undefined): Promise<string[]> {
    return withLock(client, async () => {
        const applied = new Set((await appliedMigrations(client)).map((a) => a.version));
        const files = loadMigrations();
        if (!files.some((f) => f.version === toVersion)) {
            throw new Error(`Unknown migration version "${toVersion}"`);
        }
        const done: string[] = [];
        for (const file of files) {
            if (file.version > toVersion || applied.has(file.version)) continue;
            await client.query(
                'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
                [file.version, file.name, file.checksum]
            );
            log(`baselined ${file.version}_${file.name}`);
            done.push(file.version);
        }
        return done;
    });
}

export async function migrationStatus(client: Client): Promise<{ version: string; name: string; applied: boolean }[]> {
    const applied = new Set((await appliedMigrations(client)).map((a) => a.version));
    return loadMigrations().map((f) => ({ version: f.version, name: f.name, applied: applied.has(f.version) }));
}

function connectionConfig(database?: string): ClientConfig {
    const base = config.db.poolConfig;
    if (base.connectionString) {
        if (!database) return { connectionString: base.connectionString };
        const url = new URL(base.connectionString);
        url.pathname = `/${database}`;
        return { connectionString: url.toString() };
    }
    return {
        host: base.host,
        port: base.port,
        user: base.user,
        password: base.password as string | undefined,
        database: database || base.database,
    };
}

export async function connect(database?: string): Promise<Client> {
    const client = new Client(connectionConfig(database));
    await client.connect();
    return client;
}

/** Creates the database when it does not exist yet. Returns true when it was created. */
export async function ensureDatabase(name: string): Promise<boolean> {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Refusing to create database with unsafe name "${name}"`);
    const admin = await connect('postgres');
    try {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        if (exists.rowCount) return false;
        await admin.query(`CREATE DATABASE ${name}`);
        return true;
    } finally {
        await admin.end();
    }
}

export async function dropDatabase(name: string): Promise<void> {
    if (!/_(test|scratch)$/.test(name)) throw new Error(`Refusing to drop "${name}": only *_test / *_scratch databases may be dropped`);
    const admin = await connect('postgres');
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
        await admin.end();
    }
}
