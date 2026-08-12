/**
 * Reference numbers are derived from the row's own primary key rather than
 * from a COUNT(*) + 1, which races under concurrent inserts and silently
 * produces duplicates. Records are created with a temporary unique value and
 * immediately rewritten inside the same transaction.
 */

export type EntityPrefix = 'INC' | 'AUD' | 'CA';

export function formatReference(prefix: EntityPrefix, id: number, when: Date = new Date()): string {
  return `${prefix}-${when.getFullYear()}-${String(id).padStart(4, '0')}`;
}

let counter = 0;
export function temporaryReference(prefix: EntityPrefix): string {
  counter += 1;
  return `${prefix}-PENDING-${Date.now()}-${counter}`;
}
