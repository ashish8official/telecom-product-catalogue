export default async function globalSetup(): Promise<void> {
    process.env.NODE_ENV = 'test';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const migrator = require('../db/migrator');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tasks = require('../db/tasks');
    await migrator.ensureDatabase(config.db.database);
    const client = await migrator.connect();
    try {
        await migrator.migrateUp(client);
        await tasks.runSeeds(client);
    } finally {
        await client.end();
    }
}
