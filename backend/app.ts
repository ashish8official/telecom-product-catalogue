import path from 'path';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { internalRouter } from './api/internal/routes';
import { BASE_PATH } from './api/tmf620/adapter';
import { tmf620Router } from './api/tmf620/routes';
import { config } from './config';
import { pingDatabase } from './db/pool';
import { notFound } from './http/errors';
import {
    accessLog,
    jsonErrorHandler,
    requestId,
    requireAdminForWrites,
    securityHeaders,
    tenantContext,
    tmfErrorHandler,
} from './http/middleware';

export function createApp() {
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
    app.set('query parser', 'extended');

    app.use(requestId);
    app.use(accessLog);
    app.use(securityHeaders);
    app.use(
        cors({
            // Same-origin UIs need no CORS. Other browser origins must be listed in CORS_ORIGINS.
            origin: config.corsOrigins.length ? config.corsOrigins : false,
            exposedHeaders: ['X-Total-Count', 'X-Result-Count', 'X-Request-Id', 'Location'],
        })
    );
    app.use(express.json({ limit: '1mb', type: ['application/json', 'application/merge-patch+json', 'application/*+json'] }));

    // Liveness: the process is up. Readiness: it can reach the database.
    app.get('/health', (_req, res) => void res.json({ status: 'ok' }));
    app.get('/ready', async (_req, res) => {
        try {
            await pingDatabase();
            res.json({ status: 'ready', database: 'ok' });
        } catch {
            res.status(503).json({ status: 'unavailable', database: 'unreachable' });
        }
    });

    // TMF620 adapter layer: the external integration surface.
    app.use(BASE_PATH, tenantContext, requireAdminForWrites, tmf620Router);
    app.use(BASE_PATH, (req: Request, _res: Response, next: NextFunction) => next(notFound('Resource', req.path)));
    app.use(BASE_PATH, tmfErrorHandler);

    // Internal administration API for the catalogue admin UI.
    app.use('/api/internal', tenantContext, requireAdminForWrites, internalRouter);
    app.use('/api/internal', (req: Request, _res: Response, next: NextFunction) => next(notFound('Endpoint', req.path)));
    app.use('/api/internal', jsonErrorHandler);

    // Static UIs. They are plain files; everything they show comes through the APIs above.
    const staticOptions = { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 };
    app.use('/admin', express.static(path.join(config.paths.frontend, 'catalogue-admin'), staticOptions));
    app.use('/viewer', express.static(path.join(config.paths.frontend, 'catalogue-viewer'), staticOptions));
    app.use('/assets', express.static(path.join(config.paths.frontend, 'shared'), staticOptions));
    app.get('/', (_req, res) => res.redirect('/admin/'));

    app.use((req: Request, _res: Response, next: NextFunction) => next(notFound('Path', req.path)));
    app.use(jsonErrorHandler);

    return app;
}

export const app = createApp();
