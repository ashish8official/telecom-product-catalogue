import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ApiRole, config, isUuid } from '../config';
import { AppError, badRequest, forbidden, toAppError, unauthorized } from './errors';
import { logger } from './logger';

export interface RequestContext {
    requestId: string;
    tenantId: string;
    role: ApiRole;
    authMode: 'api-key' | 'dev-header';
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            requestId: string;
            ctx?: RequestContext;
        }
    }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && /^[\w.:-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
}

export function accessLog(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
        if (req.path === '/health' || req.path === '/ready') return;
        logger.info('request', {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            status: res.statusCode,
            durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
            tenantId: req.ctx?.tenantId,
        });
    });
    next();
}

/** Conservative security headers (the subset of helmet's defaults that matters for a JSON API + static UI). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
}

function timingSafeLookup(presented: string) {
    const presentedBuf = Buffer.from(presented);
    for (const [key, entry] of config.apiKeys) {
        const keyBuf = Buffer.from(key);
        if (keyBuf.length === presentedBuf.length && crypto.timingSafeEqual(keyBuf, presentedBuf)) return entry;
    }
    return undefined;
}

/**
 * Resolves the caller's tenant.
 *
 * With API_KEYS configured, the tenant comes from the key (x-api-key or "Authorization: Bearer"),
 * never from a header the caller controls; an x-tenant-id header that disagrees is rejected.
 * Without keys (local development only) the x-tenant-id header is trusted and the caller is admin.
 */
export function tenantContext(req: Request, _res: Response, next: NextFunction): void {
    try {
        const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
        const apiKey = req.header('x-api-key') || bearer;
        const headerTenant = req.header('x-tenant-id');

        if (config.apiKeys.size > 0) {
            if (!apiKey) throw unauthorized('An API key is required (x-api-key header or Authorization: Bearer)');
            const entry = timingSafeLookup(apiKey);
            if (!entry) throw unauthorized('The API key is not valid');
            if (headerTenant && headerTenant.toLowerCase() !== entry.tenantId) {
                throw forbidden('x-tenant-id does not match the tenant of the API key');
            }
            req.ctx = { requestId: req.requestId, tenantId: entry.tenantId, role: entry.role, authMode: 'api-key' };
        } else {
            if (!headerTenant) throw badRequest('x-tenant-id header is required');
            if (!isUuid(headerTenant)) throw badRequest('x-tenant-id must be a UUID');
            req.ctx = { requestId: req.requestId, tenantId: headerTenant.toLowerCase(), role: 'admin', authMode: 'dev-header' };
        }
        next();
    } catch (err) {
        next(err);
    }
}

/** Write operations need the admin role. */
export function requireAdminForWrites(req: Request, _res: Response, next: NextFunction): void {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.ctx?.role !== 'admin') {
        next(forbidden('This API key is read-only'));
        return;
    }
    next();
}

export function ctx(req: Request): RequestContext {
    if (!req.ctx) throw new AppError(500, 'INTERNAL_ERROR', 'Request context missing');
    return req.ctx;
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
    <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
    (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };

function logIfServerError(err: unknown, appErr: AppError, req: Request): void {
    if (appErr.status >= 500) {
        logger.error('unhandled error', {
            requestId: req.requestId,
            path: req.originalUrl,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
    }
}

/** Plain JSON errors for the internal API and anything outside TMF620. */
export function jsonErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    const appErr = toAppError(err);
    logIfServerError(err, appErr, req);
    res.status(appErr.status).json({
        error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
        requestId: req.requestId,
    });
}

/** TMF630 / TMF620 Error resource shape. */
export function tmfErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    const appErr = toAppError(err);
    logIfServerError(err, appErr, req);
    res.status(appErr.status).json({
        '@type': 'Error',
        code: appErr.code,
        reason: appErr.message,
        message: appErr.details ? JSON.stringify(appErr.details) : undefined,
        status: String(appErr.status),
        requestId: req.requestId,
    });
}
