/**
 * FabOrch Audit — REQ-01 DDL/DML guard.
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

export function isReadOnlySql(sql: string): boolean {
  const stripped = sql.replace(COMMENT_PATTERN, '').trim();
  if (!stripped) return false;
  if (FORBIDDEN_PATTERN.test(stripped)) return false;
  const head = stripped.replace(/^[(\s]+/, '').slice(0, 8).toUpperCase();
  return head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('SHOW') || head.startsWith('EXPLAIN');
}

export function assertReadOnlySql(sql: string, route?: string): string {
  if (!isReadOnlySql(sql)) {
    throw FabOrchError.ddlDmlRejected(undefined, {
      route,
      extra: { sqlPreview: sql.slice(0, 200) },
    });
  }
  return sql;
}
