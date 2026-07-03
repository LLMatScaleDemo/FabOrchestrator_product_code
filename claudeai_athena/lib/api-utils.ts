/**
 * API utilities for error handling, retry logic, and network management
 */

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  retryAfter?: number;
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }

  static isRateLimitError(error: unknown): error is ApiRequestError {
    return error instanceof ApiRequestError && error.status === 429;
  }

  static isNetworkError(error: unknown): boolean {
    return error instanceof TypeError && error.message.includes('fetch');
  }

  static isTimeoutError(error: unknown): error is ApiRequestError {
    return error instanceof ApiRequestError && error.code === 'TIMEOUT';
  }
}

/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryOn?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryOn: (error) => {
    // Retry on network errors, 5xx errors, and 429 (rate limit)
    if (ApiRequestError.isNetworkError(error)) return true;
    if (error instanceof ApiRequestError) {
      return error.status >= 500 || error.status === 429;
    }
    return false;
  },
  onRetry: () => {},
};

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt < config.maxRetries && config.retryOn(error, attempt)) {
        config.onRetry(error, attempt);

        // Handle rate limit with specific retry-after header
        if (error instanceof ApiRequestError && error.retryAfter) {
          await sleep(error.retryAfter * 1000);
        } else {
          await sleep(delay);
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
        }
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiRequestError('Request timed out', 408, 'TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make an API request with error handling
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);

  // Check for rate limiting
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    throw new ApiRequestError('Rate limit exceeded', 429, 'RATE_LIMIT', retryAfter);
  }

  // Check for other errors
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiRequestError(message, response.status);
  }

  return response.json();
}

/**
 * Make an API request with automatic retry
 */
export async function apiRequestWithRetry<T>(
  url: string,
  options: RequestInit & { timeout?: number; retry?: RetryOptions } = {}
): Promise<T> {
  const { retry, ...fetchOptions } = options;

  return withRetry(() => apiRequest<T>(url, fetchOptions), retry);
}

/**
 * Check if the browser is online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Wait for the browser to come online
 */
export function waitForOnline(): Promise<void> {
  return new Promise((resolve) => {
    if (isOnline()) {
      resolve();
      return;
    }

    const handleOnline = () => {
      window.removeEventListener('online', handleOnline);
      resolve();
    };

    window.addEventListener('online', handleOnline);
  });
}

/**
 * Parse error message for display
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.status) {
      case 401:
        return 'Your session has expired. Please log in again.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again later.';
      default:
        return error.message;
    }
  }

  if (ApiRequestError.isNetworkError(error)) {
    return 'Network error. Please check your internet connection.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}

/**
 * Determine if an error is retriable
 */
export function isRetriableError(error: unknown): boolean {
  if (ApiRequestError.isNetworkError(error)) return true;
  if (error instanceof ApiRequestError) {
    return error.status >= 500 || error.status === 429 || error.status === 408;
  }
  return false;
}
