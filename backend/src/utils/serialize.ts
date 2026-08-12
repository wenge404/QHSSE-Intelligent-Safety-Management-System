import { Prisma } from '@prisma/client';

/**
 * Prisma returns DECIMAL columns as Decimal.js instances, which JSON.stringify
 * renders as strings. The frontend does arithmetic on pressure, diameter and
 * cost, so they are converted to numbers once here rather than being parsed at
 * a dozen call sites.
 */
export function toPlain<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (Prisma.Decimal.isDecimal(value)) {
    return (value as Prisma.Decimal).toNumber() as unknown as T;
  }

  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((item) => toPlain(item)) as unknown as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toPlain(item);
    }
    return out as T;
  }

  return value;
}
