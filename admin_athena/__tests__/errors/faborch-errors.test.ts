/**
 * REQ-01 acceptance tests for the admin app's copy of the catalog.
 *
 * Run with: npx tsx --test __tests__/errors/faborch-errors.test.ts
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
import { classifyError } from '../../lib/errors/api-error-handler';

describe('REQ-01 catalog (admin)', () => {
  it('defines all 10 canonical error types', () => {
    assert.equal(Object.keys(FABORCH_ERROR_CATALOG).length, 10);
  });

  it('has matching priorities and statuses', () => {
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SESSION_TIMEOUT].priority, FabOrchErrorPriority.MEDIUM);
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.SESSION_TIMEOUT].httpStatus, 401);
    assert.equal(FABORCH_ERROR_CATALOG[FabOrchErrorType.NO_ROWS_RETURNED].userMessage, 'No data found for that request.');
  });
});

describe('FabOrchError class (admin)', () => {
  it('exposes envelope fields', () => {
    const env = FabOrchError.lambdaMcpCrash(new Error('crash'), { route: '/api/admin/x' }).toEnvelope();
    assert.equal(env.type, FabOrchErrorType.LAMBDA_MCP_CRASH);
    assert.equal(env.httpStatus, 500);
    assert.match(env.errorId, /[0-9a-f-]{8,}/);
  });

  it('isFabOrchError type guard', () => {
    assert.equal(isFabOrchError(FabOrchError.sqlCallFailure()), true);
    assert.equal(isFabOrchError(new Error('plain')), false);
  });
});

describe('classifyError (admin)', () => {
  it('AbortError → RESPONSE_TIMEOUT', () => {
    const e = new Error('aborted'); e.name = 'AbortError';
    assert.equal(classifyError(e), FabOrchErrorType.RESPONSE_TIMEOUT);
  });
  it('Prisma P2025 → NO_ROWS_RETURNED', () => {
    const e = Object.assign(new Error('not found'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
    assert.equal(classifyError(e), FabOrchErrorType.NO_ROWS_RETURNED);
  });
});

describe('row cap (admin)', () => {
  it('caps over 1000', () => {
    const big = new Array(1500).fill(0);
    const r = applyRowCap(big);
    assert.equal(r.rows.length, ROW_CAP_LIMIT);
    assert.ok(r.warning);
  });
  it('clampLimit', () => {
    assert.equal(clampLimit(99999), ROW_CAP_LIMIT);
  });
});

describe('SQL guard (admin)', () => {
  it('allows SELECT', () => assert.equal(isReadOnlySql('SELECT 1'), true));
  it('rejects DROP', () => {
    let thrown: unknown = null;
    try { assertReadOnlySql('DROP TABLE x'); } catch (e) { thrown = e; }
    assert.ok(isFabOrchError(thrown));
  });
});
