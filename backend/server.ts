import { app } from './app';
import { config } from './config';
import { closePool, pingDatabase } from './db/pool';
import { logger } from './http/logger';

async function start(): Promise<void> {
    try {
        await pingDatabase();
    } catch (err: any) {
        logger.error('database unreachable at startup', { error: err.message, database: config.db.database });
        process.exit(1);
    }

    const server = app.listen(config.port, () => {
        logger.info('product catalogue listening', {
            port: config.port,
            database: config.db.database,
            auth: config.apiKeys.size ? `${config.apiKeys.size} API key(s)` : 'development mode (x-tenant-id header, no API keys)',
            admin: `http://localhost:${config.port}/admin/`,
            viewer: `http://localhost:${config.port}/viewer/`,
            tmf620: `http://localhost:${config.port}/productCatalogManagement/v5/`,
        });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
        logger.error(err.code === 'EADDRINUSE' ? `port ${config.port} is already in use` : 'server failed to start', { error: err.message });
        process.exit(1);
    });

    let stopping = false;
    const shutdown = (signal: string) => {
        if (stopping) return;
        stopping = true;
        logger.info('shutting down', { signal });
        server.close(async () => {
            await closePool();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

void start();
