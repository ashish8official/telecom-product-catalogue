/* eslint-disable no-console */
/**
 * Database CLI.
 *
 *   ts-node scripts/db.ts migrate            apply pending migrations
 *   ts-node scripts/db.ts rollback [n]       revert the last n migrations (default 1)
 *   ts-node scripts/db.ts status             list migrations and whether they are applied
 *   ts-node scripts/db.ts baseline <version> mark migrations up to <version> as applied without running them
 *   ts-node scripts/db.ts seed               load database/seeds/*.sql (demo tenant only)
 *   ts-node scripts/db.ts test               run database/tests/*.sql, each rolled back afterwards
 *   ts-node scripts/db.ts verify-rollback    up -> down -> up on a throwaway database
 *
 * Add --test to target the isolated test database instead of the configured one.
 */
const args = process.argv.slice(2).filter((a) => a !== '--test');
if (process.argv.includes('--test')) process.env.NODE_ENV = 'test';

// Imported after NODE_ENV is settled because config reads it at load time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config } = require('../config') as typeof import('../config');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrator = require('../db/migrator') as typeof import('../db/migrator');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tasks = require('../db/tasks') as typeof import('../db/tasks');

async function main(): Promise<void> {
    const [command, arg] = args;
    const log = (m: string) => console.log(m);
    const database = config.db.database;

    if (command === 'verify-rollback') {
        await tasks.verifyRollback(log);
        return;
    }

    if (command === 'migrate' || command === 'test') {
        if (await migrator.ensureDatabase(database)) log(`created database ${database}`);
    }

    const client = await migrator.connect();
    try {
        switch (command) {
            case 'migrate': {
                const done = await migrator.migrateUp(client, { log });
                log(done.length ? `${done.length} migration(s) applied to ${database}` : `${database} is up to date`);
                break;
            }
            case 'rollback': {
                const done = await migrator.migrateDown(client, arg ? Number.parseInt(arg, 10) : 1, log);
                log(`${done.length} migration(s) reverted on ${database}`);
                break;
            }
            case 'status': {
                for (const row of await migrator.migrationStatus(client)) {
                    log(`${row.applied ? 'applied ' : 'PENDING '} ${row.version}_${row.name}`);
                }
                break;
            }
            case 'baseline': {
                if (!arg) throw new Error('usage: baseline <version>, e.g. baseline 016');
                const done = await migrator.baseline(client, arg, log);
                log(`${done.length} migration(s) recorded as already applied on ${database}`);
                break;
            }
            case 'seed': {
                const files = await tasks.runSeeds(client);
                log(`seeded ${database} from ${files.join(', ')}`);
                break;
            }
            case 'test': {
                await migrator.migrateUp(client, { log });
                const results = await tasks.runSqlTests(client);
                for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'} ${r.file}${r.ok ? '' : `\n     ${r.error}`}`);
                const failed = results.filter((r) => !r.ok).length;
                log(`${results.length - failed}/${results.length} SQL test files passed on ${database}`);
                if (failed) process.exitCode = 1;
                break;
            }
            default:
                throw new Error('usage: db.ts <migrate|rollback|status|baseline|seed|test|verify-rollback> [--test]');
        }
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
