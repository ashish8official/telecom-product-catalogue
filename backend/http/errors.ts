import { ZodError } from 'zod';

/**
 * Application errors carry an HTTP status and a stable machine-readable code.
 * They are raised by services and translated to a response body by the error middleware;
 * the TMF620 router renders them in TMF Error shape, the internal API in a plain shape.
 */
export class AppError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'This operation is not allowed for your role') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what: string, id?: string) =>
    new AppError(404, 'NOT_FOUND', id ? `${what} ${id} not found` : `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', message, details);

/** PostgreSQL error codes we translate. Everything else is an internal error. */
const PG = {
    UNIQUE: '23505',
    FOREIGN_KEY: '23503',
    RESTRICT: '23001',
    NOT_NULL: '23502',
    CHECK: '23514',
    INVALID_TEXT: '22P02',
    INVALID_DATETIME: '22007',
    DATETIME_OVERFLOW: '22008',
    NUMERIC_OVERFLOW: '22003',
    STRING_TOO_LONG: '22001',
    CATALOGUE_LOCKED: 'CV001',
    RAISED: 'P0001',
};

/**
 * Converts anything thrown into an AppError. Database messages are only passed through where
 * they describe the client's own input; anything else becomes a generic 500 so internal details
 * (SQL, table names, stack traces) never reach API consumers.
 */
export function toAppError(err: unknown): AppError {
    if (err instanceof AppError) return err;

    if (err instanceof ZodError) {
        return badRequest(
            'Request validation failed',
            err.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }))
        );
    }

    // body-parser JSON syntax errors
    if (err && typeof err === 'object' && (err as any).type === 'entity.parse.failed') {
        return badRequest('Request body is not valid JSON');
    }
    if (err && typeof err === 'object' && (err as any).type === 'entity.too.large') {
        return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }

    const pgCode = err && typeof err === 'object' ? (err as any).code : undefined;
    const constraint: string | undefined = err && typeof err === 'object' ? (err as any).constraint : undefined;
    const message: string = err instanceof Error ? err.message : String(err);

    switch (pgCode) {
        case PG.CATALOGUE_LOCKED:
            return conflict(message);
        case PG.UNIQUE:
            return conflict('A record with the same identifying values already exists', { constraint });
        case PG.RESTRICT:
            return conflict('This record is still in use and cannot be removed', { constraint });
        case PG.FOREIGN_KEY:
            return conflict(
                /still referenced|is still referenced/i.test((err as any).detail || '')
                    ? 'This record is still in use and cannot be removed'
                    : 'A referenced record does not exist for this tenant',
                { constraint }
            );
        case PG.CHECK:
            return unprocessable('A value is outside the allowed range or set', { constraint });
        case PG.NOT_NULL:
            return unprocessable(`Missing required value: ${(err as any).column ?? 'unknown field'}`);
        case PG.INVALID_TEXT:
        case PG.INVALID_DATETIME:
        case PG.DATETIME_OVERFLOW:
            return badRequest('A supplied identifier or value has an invalid format');
        case PG.NUMERIC_OVERFLOW:
        case PG.STRING_TOO_LONG:
            return unprocessable('A supplied value is too large');
        case PG.RAISED:
            // Raised deliberately by our own triggers (e.g. catalogue_version_status_check).
            return conflict(message);
        default:
            return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
}
