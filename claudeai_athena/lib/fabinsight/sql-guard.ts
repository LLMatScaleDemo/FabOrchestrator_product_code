/**
 * Read-only guard for admin-created ("custom") dashboard SQL.
 *
 * Custom dashboards run whatever SQL the agent produced from the admin's
 * request — including later, unattended, on a schedule. The MES connection is a
 * SELECT-only channel by convention (see lib/fabinsight/mcp.ts), but convention
 * is not enough for stored, replayed SQL. This narrows every custom query to a
 * single read-only SELECT before it is ever stored or executed.
 *
 * The check strips comments and string literals first, so a keyword appearing
 * inside quoted data ('...cancelled order...') never trips it — only real SQL
 * tokens do.
 */

/** Statement-shaping / write / admin verbs that must never appear in a custom query. */
const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'merge',
  'grant', 'revoke', 'exec', 'execute', 'call', 'bulk', 'backup', 'restore',
  'shutdown', 'waitfor', 'openrowset', 'openquery', 'openxml', 'reconfigure',
];

export class UnsafeSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeSqlError';
  }
}

/** Remove -- line comments, /* *​/ block comments, and '...' string literals. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

/**
 * Throw UnsafeSqlError unless `sql` is a single, read-only SELECT (a leading CTE
 * `WITH ... SELECT` is allowed). Returns the cleaned single statement (trailing
 * semicolon removed) so the caller can store exactly what will run.
 */
export function assertReadOnlySelect(sql: string): string {
  const raw = (sql ?? '').trim();
  if (!raw) throw new UnsafeSqlError('Query is empty.');
  if (raw.length > 20000) throw new UnsafeSqlError('Query is too long.');

  const scan = stripCommentsAndStrings(raw).trim();

  // Single statement only: at most one trailing semicolon, none in the middle.
  const withoutTrailing = scan.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new UnsafeSqlError('Only a single SELECT statement is allowed (no ";").');
  }

  // Must begin with SELECT, or WITH (a CTE that must itself feed a SELECT).
  if (!/^\s*(select|with)\b/i.test(withoutTrailing)) {
    throw new UnsafeSqlError('Only read-only SELECT queries are allowed.');
  }
  if (/^\s*with\b/i.test(withoutTrailing) && !/\bselect\b/i.test(withoutTrailing)) {
    throw new UnsafeSqlError('A WITH clause must resolve to a SELECT.');
  }

  // No write / DDL / admin verbs anywhere (word-boundary, on the stripped text).
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(withoutTrailing)) {
      throw new UnsafeSqlError(`Query contains a disallowed keyword: "${kw}".`);
    }
  }
  // SELECT ... INTO <table> materialises a table — block it specifically.
  if (/\binto\b/i.test(withoutTrailing)) {
    throw new UnsafeSqlError('SELECT ... INTO is not allowed.');
  }
  // T-SQL system/extended stored procs.
  if (/\b(sp|xp)_\w+/i.test(withoutTrailing)) {
    throw new UnsafeSqlError('Stored-procedure calls are not allowed.');
  }

  // Store the statement without its trailing semicolon (mssql runs one statement).
  return raw.replace(/;\s*$/, '');
}
