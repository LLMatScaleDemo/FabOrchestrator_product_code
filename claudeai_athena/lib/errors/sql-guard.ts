/**
 * FabOrch Audit — REQ-01 DDL/DML guard.
 *
 * FabOrch never accepts user-authored SQL today, but we add this guard
 * for defense in depth. Any future raw-SQL path must pass through this
 * function before execution.
 */

import { FabOrchError } from './faborch-errors';

const FORBIDDEN_KEYWORDS: ReadonlyArray<string> = Object.freeze([
  'DROP',
  'DELETE',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'INSERT',
  'UPDATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
  'MERGE',
  'CALL',
]);

const FORBIDDEN_PATTERN = new RegExp(
  `(?:^|[\\s;(])(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`,
  'i'
);

const COMMENT_PATTERN = /(--.*$|\/\*[\s\S]*?\*\/)/gm;

/**
 * Returns true if the SQL string is read-only (single SELECT or WITH/CTE).
 */
export function isReadOnlySql(sql: string): boolean {
  const stripped = sql.replace(COMMENT_PATTERN, '').trim();
  if (!stripped) return false;
  if (FORBIDDEN_PATTERN.test(stripped)) return false;
  const head = stripped.replace(/^[(\s]+/, '').slice(0, 8).toUpperCase();
  return head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('SHOW') || head.startsWith('EXPLAIN');
}

/**
 * Throws DDL_DML_REJECTED if the SQL is not strictly read-only.
 * Returns the input unchanged when allowed.
 */
export function assertReadOnlySql(sql: string, route?: string): string {
  if (!isReadOnlySql(sql)) {
    throw FabOrchError.ddlDmlRejected(undefined, {
      route,
      extra: { sqlPreview: sql.slice(0, 200) },
    });
  }
  return sql;
}
