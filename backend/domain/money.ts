/**
 * Exact fixed-point arithmetic for catalogue amounts.
 *
 * The database stores money as NUMERIC(16,6). JavaScript numbers cannot represent most of those
 * values exactly, so amounts are carried as BigInt micro-units (1 unit = 1_000_000) and only turned
 * into strings at the edge. Rounding is half-away-from-zero, the convention billing systems expect.
 */
export const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export type Micros = bigint;

export function parseAmount(value: string | number): Micros {
    const text = typeof value === 'number' ? value.toFixed(SCALE) : value.trim();
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new Error(`Not a decimal amount: "${value}"`);
    const [, sign, whole, fraction = ''] = match;
    const digits = (fraction + '0'.repeat(SCALE + 1)).slice(0, SCALE + 1);
    let micros = BigInt(whole) * FACTOR + BigInt(digits.slice(0, SCALE));
    if (Number(digits[SCALE]) >= 5) micros += 1n;
    return sign ? -micros : micros;
}

export function formatAmount(micros: Micros): string {
    const negative = micros < 0n;
    const abs = negative ? -micros : micros;
    const whole = abs / FACTOR;
    const fraction = (abs % FACTOR).toString().padStart(SCALE, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** amount × percent / 100, rounded to 6 decimal places. */
export function percentOf(amount: Micros, percent: Micros): Micros {
    const product = amount * percent; // scale 12
    const divisor = 100n * FACTOR;
    const quotient = product / divisor;
    const remainder = product % divisor;
    const twice = (remainder < 0n ? -remainder : remainder) * 2n;
    if (twice >= divisor) return product < 0n ? quotient - 1n : quotient + 1n;
    return quotient;
}

export const toNumber = (micros: Micros): number => Number(formatAmount(micros));
