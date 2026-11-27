import { z } from 'zod';
import { badRequest } from './errors';

export { z };

export const uuid = z.string().uuid({ message: 'must be a UUID' });
export const code = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'must be upper-case letters, digits, "_" or "-"');
export const name = z.string().trim().min(1).max(255);
export const isoDate = z
    .string()
    .datetime({ offset: true, message: 'must be an ISO-8601 date-time with a time zone, e.g. 2026-01-01T00:00:00Z' })
    .transform((s) => new Date(s));
export const nullableIsoDate = z.union([isoDate, z.null()]);
/** Money/rate amounts are strings or numbers with at most 6 decimals (NUMERIC(16,6)). */
export const amount = z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((v) => /^-?\d{1,10}(\.\d{1,6})?$/.test(v), 'must be a decimal with at most 10 integer and 6 fractional digits');
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as USD');

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
    return schema.parse(value);
}

export function parseId(value: unknown, label = 'id'): string {
    const result = uuid.safeParse(value);
    if (!result.success) throw badRequest(`${label} must be a UUID`);
    return result.data;
}

export function optionalDate(value: unknown, label: string): Date | undefined {
    if (value === undefined || value === '') return undefined;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw badRequest(`${label} must be a valid ISO-8601 date-time`);
    return d;
}

export function optionalString(value: unknown, label: string, max = 255): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
        throw badRequest(`${label} must be a non-empty string of at most ${max} characters`);
    }
    return value.trim();
}

export function pagination(query: Record<string, unknown>, maxLimit = 1000): { limit: number; offset: number } {
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw badRequest(`limit must be an integer between 1 and ${maxLimit}`);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest('offset must be a non-negative integer');
    return { limit, offset };
}
