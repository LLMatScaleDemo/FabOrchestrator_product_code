/**
 * FabOrch Audit — REQ-01 row-cap helper.
 */

import {
  FABORCH_ERROR_CATALOG,
  FabOrchErrorPriority,
  FabOrchErrorType,
  ROW_CAP_LIMIT,
} from './faborch-errors';

export interface RowCapWarning {
  type: FabOrchErrorType.ROW_CAP_EXCEEDED;
  priority: FabOrchErrorPriority;
  userMessage: string;
  limit: number;
  totalCount?: number;
}

export interface RowCappedResult<T> {
  rows: T[];
  warning?: RowCapWarning;
}

export function applyRowCap<T>(rows: T[], totalCount?: number): RowCappedResult<T> {
  if (rows.length <= ROW_CAP_LIMIT && (totalCount === undefined || totalCount <= ROW_CAP_LIMIT)) {
    return { rows };
  }
  const entry = FABORCH_ERROR_CATALOG[FabOrchErrorType.ROW_CAP_EXCEEDED];
  return {
    rows: rows.slice(0, ROW_CAP_LIMIT),
    warning: {
      type: FabOrchErrorType.ROW_CAP_EXCEEDED,
      priority: entry.priority,
      userMessage: entry.userMessage,
      limit: ROW_CAP_LIMIT,
      totalCount,
    },
  };
}

export function clampLimit(requested: number | undefined, fallback = 100): number {
  const n = Number.isFinite(requested) ? Number(requested) : fallback;
  if (n <= 0) return fallback;
  return Math.min(n, ROW_CAP_LIMIT);
}

export { ROW_CAP_LIMIT };
