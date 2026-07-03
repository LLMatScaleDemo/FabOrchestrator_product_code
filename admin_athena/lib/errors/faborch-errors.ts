/**
 * FabOrch Audit — REQ-01 canonical error catalog.
 *
 * Single source of truth for the 10 error types defined in the requirements
 * document. User-facing strings here are the contract — never hand-write
 * these messages anywhere else; import from this module.
 */

export enum FabOrchErrorType {
  SQL_CALL_FAILURE = 'SQL_CALL_FAILURE',
  RESPONSE_TIMEOUT = 'RESPONSE_TIMEOUT',
  NO_ROWS_RETURNED = 'NO_ROWS_RETURNED',
  MISSING_FILTER = 'MISSING_FILTER',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  DDL_DML_REJECTED = 'DDL_DML_REJECTED',
  LAMBDA_MCP_CRASH = 'LAMBDA_MCP_CRASH',
  SESSION_TIMEOUT = 'SESSION_TIMEOUT',
  ROW_CAP_EXCEEDED = 'ROW_CAP_EXCEEDED',
  UNLISTED_STORED_PROC = 'UNLISTED_STORED_PROC',
}

export enum FabOrchErrorPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
}

export interface FabOrchErrorEntry {
  type: FabOrchErrorType;
  priority: FabOrchErrorPriority;
  userMessage: string;
  httpStatus: number;
}

export const FABORCH_ERROR_CATALOG: Readonly<
  Record<FabOrchErrorType, FabOrchErrorEntry>
> = Object.freeze({
  [FabOrchErrorType.SQL_CALL_FAILURE]: {
    type: FabOrchErrorType.SQL_CALL_FAILURE,
    priority: FabOrchErrorPriority.HIGH,
    userMessage: 'I cannot reach the data right now. Please retry.',
    httpStatus: 503,
  },
  [FabOrchErrorType.RESPONSE_TIMEOUT]: {
    type: FabOrchErrorType.RESPONSE_TIMEOUT,
    priority: FabOrchErrorPriority.HIGH,
    userMessage:
      'The request took too long to complete. Please try again or narrow your request.',
    httpStatus: 504,
  },
  [FabOrchErrorType.NO_ROWS_RETURNED]: {
    type: FabOrchErrorType.NO_ROWS_RETURNED,
    priority: FabOrchErrorPriority.HIGH,
    userMessage: 'No data found for that request.',
    httpStatus: 404,
  },
  [FabOrchErrorType.MISSING_FILTER]: {
    type: FabOrchErrorType.MISSING_FILTER,
    priority: FabOrchErrorPriority.HIGH,
    userMessage:
      'I need one more detail before I can answer that. Could you clarify?',
    httpStatus: 400,
  },
  [FabOrchErrorType.INVALID_PARAMETER]: {
    type: FabOrchErrorType.INVALID_PARAMETER,
    priority: FabOrchErrorPriority.HIGH,
    userMessage:
      'That value is not valid. Please choose one of the available options.',
    httpStatus: 400,
  },
  [FabOrchErrorType.DDL_DML_REJECTED]: {
    type: FabOrchErrorType.DDL_DML_REJECTED,
    priority: FabOrchErrorPriority.HIGH,
    userMessage: 'That operation is not permitted.',
    httpStatus: 403,
  },
  [FabOrchErrorType.LAMBDA_MCP_CRASH]: {
    type: FabOrchErrorType.LAMBDA_MCP_CRASH,
    priority: FabOrchErrorPriority.HIGH,
    userMessage:
      'A backend service is temporarily unavailable. Please try again in a moment.',
    httpStatus: 500,
  },
  [FabOrchErrorType.SESSION_TIMEOUT]: {
    type: FabOrchErrorType.SESSION_TIMEOUT,
    priority: FabOrchErrorPriority.MEDIUM,
    userMessage: 'Your session has expired. Please log in again.',
    httpStatus: 401,
  },
  [FabOrchErrorType.ROW_CAP_EXCEEDED]: {
    type: FabOrchErrorType.ROW_CAP_EXCEEDED,
    priority: FabOrchErrorPriority.MEDIUM,
    userMessage:
      'Returned the first 1000 rows. Please refine your filter to narrow the results.',
    httpStatus: 200,
  },
  [FabOrchErrorType.UNLISTED_STORED_PROC]: {
    type: FabOrchErrorType.UNLISTED_STORED_PROC,
    priority: FabOrchErrorPriority.MEDIUM,
    userMessage: 'That procedure is not available.',
    httpStatus: 404,
  },
});

export const ROW_CAP_LIMIT = 1000;

export interface FabOrchErrorContext {
  route?: string;
  method?: string;
  userId?: string;
  sessionId?: string;
  parameter?: string;
  toolName?: string;
  validOptions?: ReadonlyArray<string>;
  extra?: Record<string, unknown>;
}

export interface FabOrchErrorEnvelope {
  errorId: string;
  type: FabOrchErrorType;
  priority: FabOrchErrorPriority;
  userMessage: string;
  httpStatus: number;
  context?: FabOrchErrorContext;
}

function generateErrorId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FabOrchError extends Error {
  readonly errorId: string;
  readonly type: FabOrchErrorType;
  readonly priority: FabOrchErrorPriority;
  readonly userMessage: string;
  readonly httpStatus: number;
  readonly context?: FabOrchErrorContext;

  constructor(
    type: FabOrchErrorType,
    options: {
      cause?: unknown;
      context?: FabOrchErrorContext;
      messageOverride?: string;
    } = {}
  ) {
    const entry = FABORCH_ERROR_CATALOG[type];
    super(options.messageOverride ?? entry.userMessage);
    this.name = 'FabOrchError';
    this.errorId = generateErrorId();
    this.type = type;
    this.priority = entry.priority;
    this.userMessage = options.messageOverride ?? entry.userMessage;
    this.httpStatus = entry.httpStatus;
    this.context = options.context;
    if (options.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = options.cause;
    }
  }

  toEnvelope(): FabOrchErrorEnvelope {
    return {
      errorId: this.errorId,
      type: this.type,
      priority: this.priority,
      userMessage: this.userMessage,
      httpStatus: this.httpStatus,
      context: this.context,
    };
  }

  static sqlCallFailure(cause?: unknown, context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.SQL_CALL_FAILURE, { cause, context });
  }
  static responseTimeout(cause?: unknown, context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.RESPONSE_TIMEOUT, { cause, context });
  }
  static noRowsReturned(context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.NO_ROWS_RETURNED, { context });
  }
  static missingFilter(context?: FabOrchErrorContext, customQuestion?: string) {
    return new FabOrchError(FabOrchErrorType.MISSING_FILTER, {
      context,
      messageOverride: customQuestion,
    });
  }
  static invalidParameter(
    parameter: string,
    validOptions?: ReadonlyArray<string>,
    cause?: unknown,
    extra?: Record<string, unknown>
  ) {
    return new FabOrchError(FabOrchErrorType.INVALID_PARAMETER, {
      cause,
      context: { parameter, validOptions, extra },
    });
  }
  static ddlDmlRejected(cause?: unknown, context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.DDL_DML_REJECTED, { cause, context });
  }
  static lambdaMcpCrash(cause?: unknown, context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.LAMBDA_MCP_CRASH, { cause, context });
  }
  static sessionTimeout(context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.SESSION_TIMEOUT, { context });
  }
  static rowCapExceeded(context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.ROW_CAP_EXCEEDED, { context });
  }
  static unlistedStoredProc(toolName: string, context?: FabOrchErrorContext) {
    return new FabOrchError(FabOrchErrorType.UNLISTED_STORED_PROC, {
      context: { ...context, toolName },
    });
  }
}

export function isFabOrchError(value: unknown): value is FabOrchError {
  return value instanceof FabOrchError;
}
