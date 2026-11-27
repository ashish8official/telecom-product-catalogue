import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';

/** Anything that can run a query: the shared pool or a transaction client. */
export interface Db {
    query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<R>>;
}

export const pool = new Pool(config.db.poolConfig);

pool.on('error', (err) => {
    // An idle client failing must not crash the process; the pool replaces it.
    console.error(JSON.stringify({ level: 'error', msg: 'idle postgres client error', error: err.message }));
});

/**
 * Runs `fn` inside a single transaction. Commits when it resolves, rolls back when it throws.
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* the original error is the one worth reporting */
        }
        throw err;
    } finally {
        client.release();
    }
}

export async function pingDatabase(): Promise<void> {
    await pool.query('SELECT 1');
}

export async function closePool(): Promise<void> {
    await pool.end();
}
