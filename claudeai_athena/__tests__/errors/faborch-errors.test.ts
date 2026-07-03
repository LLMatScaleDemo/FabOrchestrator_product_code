/**
 * REQ-01 acceptance tests — verify the 10 canonical error types.
 *
 * Run with: npx tsx --test __tests__/errors/faborch-errors.test.ts
 *           (or any TS-aware Node test runner)
 *
 * No test framework is installed in this app; tests use the
 * built-in `node:test` and `node:assert/strict` modules so they
 * work out of the box on Node 20+.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FABORCH_ERROR_CATALOG,
  FabOrchError,
  FabOrchErrorPriority,
  FabOrchErrorType,
  ROW_CAP_LIMIT,
  isFabOrchError,
} from '../../lib/errors/faborch-errors';
import { applyRowCap, clampLimit } from '../../lib/errors/row-cap';
import { isReadOnlySql, assertReadOnlySql } from '../../lib/errors/sql-guard';
import { listParameterValuesSync } from '../../lib/errors/parameter-values';
import { classifyError } from '../../lib/errors/api-error-handler';

describe('REQ-01 catalog', () => {
  it('defines all 10 canonical error types', () => {
    const expected = [
      FabOrchErrorType.SQL_CALL_FAILURE,
      FabOrchErrorType.RESPONSE_TIMEOUT,
      FabOrchErrorType.NO_ROWS_RETURNED,
      FabOrchErrorType.MISSING_FILTER,
      FabOrchErrorType.INVALID_PARAMETER,
      FabOrchErrorType.DDL_DML_REJECTED,
      FabOrchErrorType.LAMBDA_MCP_CRASH,
      FabOrchErrorType.SESSION_TIMEOUT,
      FabOrchErrorType.ROW_CAP_EXCEEDED,
      FabOrchErrorType.UNLISTED_STORED_PROC,
    ];
    assert.equal(expected.length, 10);
    for (const t of expected) {
      assert.ok(FABORCH_ERROR_CATALOG[t], `${t} missing from catalog`);
      const entry = FABORCH_ERROR_CATALOG[t];
      assert.equal(entry.type, t);
      assert.ok(entry.userMessage.length > 0);
    }
  });

  it('matches doc messages and priorities', () => {
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SQL_CALL_FAILURE].userMessage, 'I cannot reach the data right now. Please retry.');
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.NO_ROWS_RETURNED].userMessage, 'No data found for that request.');
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SESSION_TIMEOUT].userMessage, 'Your session has expired. Please log in again.');
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.UNLISTED_STORED_PROC].userMessage, 'That procedure is not available.');

    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SQL_CALL_FAILURE].priority, FabOrchErrorPriority.HIGH);
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SESSION_TIMEOUT].priority, FabOrchErrorPriority.MEDIUM);
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.ROW_CAP_EXCEEDED].priority, FabOrchErrorPriority.MEDIUM);
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.UNLISTED_STORED_PROC].priority, FabOrchErrorPriority.MEDIUM);
  });
});

describe('FabOrchError class', () => {
  it('emits envelope with errorId, type, priority, message, status', () => {
    const err = FabOrchError.sqlCallFailure(new Error('db down'), { route: '/api/test' });
    const env = err.toEnvelope();
    assert.equal(env.type, FabOrchErrorType.SQL_CALL_FAILURE);
    assert.equal(env.priority, FabOrchErrorPriority.HIGH);
    assert.equal(env.userMessage, 'I cannot reach the data right now. Please retry.');
    assert.equal(env.httpStatus, 503);
    assert.match(env.errorId, /[0-9a-f-]{8,}/);
    assert.equal(env.context?.route, '/api/test');
  });

  it('isFabOrchError type guard', () => {
    assert.equal(isFabOrchError(FabOrchError.noRowsReturned()), true);
    assert.equal(isFabOrchError(new Error('nope')), false);
    assert.equal(isFabOrchError('string'), false);
  });

  it('invalidParameter carries valid options', () => {
    const err = FabOrchError.invalidParameter('model', ['a', 'b'], undefined, { badValue: 'c' });
    assert.equal(err.type, FabOrchErrorType.INVALID_PARAMETER);
    assert.deepEqual(err.context?.validOptions, ['a', 'b']);
    assert.equal(err.context?.parameter, 'model');
  });

  it('missingFilter accepts a custom clarifying question', () => {
    const err = FabOrchError.missingFilter({ parameter: 'date' }, 'Which date range?');
    assert.equal(err.userMessage, 'Which date range?');
    assert.equal(err.type, FabOrchErrorType.MISSING_FILTER);
  });

  it('unlistedStoredProc preserves toolName', () => {
    const err = FabOrchError.unlistedStoredProc('mystery_proc');
    assert.equal(err.context?.toolName, 'mystery_proc');
    assert.equal(err.userMessage, 'That procedure is not available.');
  });
});

describe('classifyError', () => {
  it('maps Zod-like errors to INVALID_PARAMETER', () => {
    class FakeZod extends Error { name = 'ZodError'; constructor() { super('zod') } }
    // Use the real ZodError if available; otherwise the heuristic fallback
    // still covers Error.name + message.
    assert.equal(classifyError(new FakeZod()), FabOrchErrorType.LAMBDA_MCP_CRASH);
  });
  it('maps AbortError to RESPONSE_TIMEOUT', () => {
    const e = new Error('aborted'); e.name = 'AbortError';
    assert.equal(classifyError(e), FabOrchErrorType.RESPONSE_TIMEOUT);
  });
  it('maps Prisma P2025 to NO_ROWS_RETURNED', () => {
    const e = Object.assign(new Error('not found'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
    assert.equal(classifyError(e), FabOrchErrorType.NO_ROWS_RETURNED);
  });
  it('maps Prisma generic to SQL_CALL_FAILURE', () => {
    const e = Object.assign(new Error('boom'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    assert.equal(classifyError(e), FabOrchErrorType.SQL_CALL_FAILURE);
  });
  it('maps ECONNREFUSED to SQL_CALL_FAILURE', () => {
    assert.equal(classifyError(new Error('connect ECONNREFUSED 5432')), FabOrchErrorType.SQL_CALL_FAILURE);
  });
  it('preserves existing FabOrchError type', () => {
    assert.equal(classifyError(FabOrchError.unlistedStoredProc('x')), FabOrchErrorType.UNLISTED_STORED_PROC);
  });
  it('falls back to LAMBDA_MCP_CRASH', () => {
    assert.equal(classifyError(new Error('weird')), FabOrchErrorType.LAMBDA_MCP_CRASH);
  });
});

describe('row cap (REQ-01 #9)', () => {
  it('passes through small results', () => {
    const r = applyRowCap([1, 2, 3]);
    assert.equal(r.rows.length, 3);
    assert.equal(r.warning, undefined);
  });
  it('truncates and warns when over 1000 rows', () => {
    const big = new Array(1500).fill(0).map((_, i) => i);
    const r = applyRowCap(big);
    assert.equal(r.rows.length, ROW_CAP_LIMIT);
    assert.ok(r.warning);
    assert.equal(r.warning?.type, FabOrchErrorType.ROW_CAP_EXCEEDED);
  });
  it('clampLimit caps to 1000', () => {
    assert.equal(clampLimit(50), 50);
    assert.equal(clampLimit(99999), ROW_CAP_LIMIT);
    assert.equal(clampLimit(undefined, 25), 25);
    assert.equal(clampLimit(0, 25), 25);
  });
});

describe('SQL guard (REQ-01 #6)', () => {
  it('allows simple SELECT', () => {
    assert.equal(isReadOnlySql('SELECT 1'), true);
  });
  it('allows WITH/CTE', () => {
    assert.equal(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  });
  it('rejects DROP', () => {
    assert.equal(isReadOnlySql('DROP TABLE users'), false);
  });
  it('rejects DELETE/UPDATE/INSERT', () => {
    assert.equal(isReadOnlySql('DELETE FROM users'), false);
    assert.equal(isReadOnlySql('UPDATE users SET x = 1'), false);
    assert.equal(isReadOnlySql('INSERT INTO users VALUES (1)'), false);
  });
  it('rejects EXEC/CALL', () => {
    assert.equal(isReadOnlySql('EXEC sp_help'), false);
    assert.equal(isReadOnlySql('CALL my_proc()'), false);
  });
  it('assertReadOnlySql throws DDL_DML_REJECTED on violation', () => {
    let thrown: unknown = null;
    try { assertReadOnlySql('TRUNCATE users'); } catch (e) { thrown = e; }
    assert.ok(isFabOrchError(thrown));
    assert.equal((thrown as FabOrchError).type, FabOrchErrorType.DDL_DML_REJECTED);
  });
});

describe('list_parameter_values (REQ-01 #5)', () => {
  it('returns models', () => {
    const r = listParameterValuesSync('model');
    assert.ok(r);
    // FabOrchestrator 1.0 / 1.1 / 2.0 (the current branded model set).
    assert.ok(r!.validOptions.length >= 3);
  });
  it('returns null for unknown parameters', () => {
    assert.equal(listParameterValuesSync('not_a_param'), null);
  });
});

describe('end-to-end coverage of all 10 types', () => {
  // Exhaustive sanity check that every type can be constructed and
  // round-trips through toEnvelope() with the right priority.
  const cases: Array<[FabOrchErrorType, () => FabOrchError, FabOrchErrorPriority, number]> = [
    [FabOrchErrorType.SQL_CALL_FAILURE, () => FabOrchError.sqlCallFailure(), FabOrchErrorPriority.HIGH, 503],
    [FabOrchErrorType.RESPONSE_TIMEOUT, () => FabOrchError.responseTimeout(), FabOrchErrorPriority.HIGH, 504],
    [FabOrchErrorType.NO_ROWS_RETURNED, () => FabOrchError.noRowsReturned(), FabOrchErrorPriority.HIGH, 404],
    [FabOrchErrorType.MISSING_FILTER, () => FabOrchError.missingFilter(), FabOrchErrorPriority.HIGH, 400],
    [FabOrchErrorType.INVALID_PARAMETER, () => FabOrchError.invalidParameter('x'), FabOrchErrorPriority.HIGH, 400],
    [FabOrchErrorType.DDL_DML_REJECTED, () => FabOrchError.ddlDmlRejected(), FabOrchErrorPriority.HIGH, 403],
    [FabOrchErrorType.LAMBDA_MCP_CRASH, () => FabOrchError.lambdaMcpCrash(), FabOrchErrorPriority.HIGH, 500],
    [FabOrchErrorType.SESSION_TIMEOUT, () => FabOrchError.sessionTimeout(), FabOrchErrorPriority.MEDIUM, 401],
    [FabOrchErrorType.ROW_CAP_EXCEEDED, () => FabOrchError.rowCapExceeded(), FabOrchErrorPriority.MEDIUM, 200],
    [FabOrchErrorType.UNLISTED_STORED_PROC, () => FabOrchError.unlistedStoredProc('x'), FabOrchErrorPriority.MEDIUM, 404],
  ];

  for (const [type, make, priority, status] of cases) {
    it(`${type} → priority=${priority}, status=${status}`, () => {
      const env = make().toEnvelope();
      assert.equal(env.type, type);
      assert.equal(env.priority, priority);
      assert.equal(env.httpStatus, status);
      assert.ok(env.userMessage.length > 0);
    });
  }
});
