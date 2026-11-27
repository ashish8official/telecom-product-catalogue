import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { config } from '../config';
import { connect, dropDatabase, ensureDatabase, loadMigrations, migrateDown, migrateUp } from './migrator';

type Log = (message: string) => void;

const sqlFiles = (dir: string): string[] =>
    fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

/** Runs every seed file in order. Seed files carry their own transaction and safety guard. */
export async function runSeeds(client: Client): Promise<string[]> {
    const files = sqlFiles(config.paths.seeds);
    for (const file of files) {
        await client.query(fs.readFileSync(path.join(config.paths.seeds, file), 'utf8'));
    }
    return files;
}

export interface SqlTestResult {
    file: string;
    ok: boolean;
    error?: string;
}

/**
 * Runs each database/tests/*.sql file inside a transaction that is always rolled back,
 * so constraint tests leave no rows behind.
 */
export async function runSqlTests(client: Client, only?: string): Promise<SqlTestResult[]> {
    const results: SqlTestResult[] = [];
    for (const file of sqlFiles(config.paths.sqlTests)) {
        if (only && file !== only) continue;
        await client.query('BEGIN');
        try {
            await client.query(fs.readFileSync(path.join(config.paths.sqlTests, file), 'utf8'));
            results.push({ file, ok: true });
        } catch (err: any) {
            results.push({ file, ok: false, error: err.message });
        } finally {
            await client.query('ROLLBACK');
        }
    }
    return results;
}

/**
 * Proves every migration has a working rollback: applies all, seeds, reverts all, applies all again
 * on a throwaway database that is dropped afterwards.
 */
export async function verifyRollback(log: Log = () => undefined): Promise<void> {
    const name = 'catalogue_rollback_scratch';
    await dropDatabase(name);
    await ensureDatabase(name);
    const client = await connect(name);
    try {
        const total = loadMigrations().length;
        await migrateUp(client);
        log(`up:   ${total} migrations applied`);
        const reverted = await migrateDown(client, total);
        log(`down: ${reverted.length} migrations reverted`);
        const left = await client.query(
            `SELECT count(*)::int AS n FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name <> 'schema_migrations'`
        );
        if (left.rows[0].n !== 0) throw new Error(`${left.rows[0].n} table(s) survived a full rollback`);
        await migrateUp(client);
        log(`up:   ${total} migrations re-applied cleanly`);
    } finally {
        await client.end();
        await dropDatabase(name);
    }
}
