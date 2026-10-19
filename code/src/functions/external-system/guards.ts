import type { ErrorRecord } from '@devrev/airsync-sdk';

import type { ExtractorState } from '../extraction';

// Pure boundary guards shared by the workers: rate-limit handling, extraction
// checkpoint validation and HTTP client configuration.

export const API_ENDPOINT_PLACEHOLDER = '<REPLACE_WITH_API_ENDPOINT>';
export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const MAX_RETRY_AFTER_SECONDS = 3600;
export const MAX_PAGES_PER_INVOCATION = 10;
export const INVALID_CHECKPOINT_MESSAGE = 'Invalid extraction checkpoint';

// ---------------------------------------------------------------------------
// Rate limits and HTTP failures
// ---------------------------------------------------------------------------

// Assignable to the delay/error members of TaskResult, of the loader create /
// update response and of the attachment stream response.
export type FailureResult =
  | { status: 'delay'; delaySeconds: number }
  | { status: 'error'; error: ErrorRecord };

// Retry-After: 0 means "retry now" and is kept; negative values are invalid.
const clampRetryAfter = (seconds: number): number =>
  seconds >= 0 ? Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS) : DEFAULT_RETRY_AFTER_SECONDS;

const retryAfterFromText = (text: string): number => {
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    return clampRetryAfter(asNumber);
  }
  const asDate = Date.parse(text);
  if (Number.isFinite(asDate)) {
    // A date in the past has already elapsed.
    return clampRetryAfter(Math.max(0, (asDate - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
};

// Parses a Retry-After header (delta seconds or HTTP date) into seconds,
// falling back to the default when it is missing or invalid and capping at
// MAX_RETRY_AFTER_SECONDS.
export const parseRetryAfter = (headerValue: unknown): number => {
  const raw: unknown = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? clampRetryAfter(raw) : DEFAULT_RETRY_AFTER_SECONDS;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  return retryAfterFromText(raw.trim());
};

const readResponse = (error: unknown): { status?: unknown; headers?: unknown } | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null ? response : undefined;
};

const readHttpStatus = (error: unknown): number | undefined => {
  const status = readResponse(error)?.status;
  return typeof status === 'number' ? status : undefined;
};

// Reads a response header case-insensitively from plain header objects and
// from axios' AxiosHeaders.
export const readResponseHeader = (error: unknown, name: string): unknown => {
  const headers = readResponse(error)?.headers;
  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target);
  if (key !== undefined) {
    return (headers as Record<string, unknown>)[key];
  }
  const get = (headers as { get?: unknown }).get;
  return typeof get === 'function' ? get.call(headers, name) : undefined;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return 'unknown error';
};

// Maps an HTTP 429 to a delay honoring Retry-After, or returns undefined for
// any other error. Tasks return the delay and rethrow everything else: the SDK
// reports a thrown error without flushing repos or saving state, so a failed
// invocation never persists a cursor past data that wasn't uploaded.
export const toRateLimitDelay = (error: unknown): { status: 'delay'; delaySeconds: number } | undefined =>
  readHttpStatus(error) === 429
    ? { status: 'delay', delaySeconds: parseRetryAfter(readResponseHeader(error, 'retry-after')) }
    : undefined;

// Maps a thrown error to a delay (HTTP 429) or an error carrying the context
// and HTTP status. For loader and attachment callbacks, where a throw would
// fail the whole phase instead of just the one item.
export const toFailureResult = (error: unknown, context: string): FailureResult => {
  const delay = toRateLimitDelay(error);
  if (delay) {
    return delay;
  }
  const status = readHttpStatus(error);
  const statusPart = status !== undefined ? ` (HTTP ${status})` : '';
  return { status: 'error', error: { message: `${context}${statusPart}: ${describeError(error)}` } };
};

// ---------------------------------------------------------------------------
// Extraction checkpoint
// ---------------------------------------------------------------------------

type ExtractorBucket = ExtractorState['todos'];

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const decodeBucket = (value: unknown): ExtractorBucket => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  const { completed, nextPage } = value as { completed?: unknown; nextPage?: unknown };
  if (typeof completed !== 'boolean' || (nextPage !== undefined && !isNonNegativeInteger(nextPage))) {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  return nextPage === undefined ? { completed } : { completed, nextPage };
};

// Validates persisted extractor state before it drives pagination, so a
// corrupted cursor fails the phase instead of skipping or repeating pages.
// Keys this decoder doesn't know are kept, so fields you add to ExtractorState
// survive until you validate them here too.
export const decodeExtractorState = (value: unknown): ExtractorState => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  const record = value as Record<string, unknown>;
  if (record.runId !== undefined && typeof record.runId !== 'string') {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  return {
    ...record,
    runId: record.runId,
    todos: decodeBucket(record.todos),
    users: decodeBucket(record.users),
    attachments: decodeBucket(record.attachments),
  };
};

// ---------------------------------------------------------------------------
// HTTP client configuration
// ---------------------------------------------------------------------------

const configError = (detail: string): Error => new Error(`Invalid config: ${detail}`);

export const requireNonBlankString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(`${field} must be a non-empty string`);
  }
  return value;
};

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const parseAbsoluteUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw configError('api_endpoint must be an absolute URL');
  }
};

// Accepts only HTTPS endpoints (loopback HTTP for local tests) without
// embedded credentials, query or fragment.
export const decodeApiEndpoint = (raw: unknown): string => {
  const value = requireNonBlankString(raw, 'api_endpoint');
  if (value === API_ENDPOINT_PLACEHOLDER) {
    throw configError('api_endpoint is still the placeholder value');
  }
  const url = parseAbsoluteUrl(value);
  const isAllowedProtocol =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (!isAllowedProtocol) {
    throw configError('api_endpoint must be HTTPS (loopback HTTP allowed for tests)');
  }
  if (url.username || url.password) {
    throw configError('api_endpoint must not embed credentials');
  }
  if (url.search || url.hash) {
    throw configError('api_endpoint must not include query or fragment');
  }
  return value;
};

// Like decodeApiEndpoint, but lets the unreplaced template placeholder through
// so the in-memory example keeps working until a real endpoint is wired.
export const resolveApiEndpoint = (raw: unknown): string =>
  raw === API_ENDPOINT_PLACEHOLDER ? API_ENDPOINT_PLACEHOLDER : decodeApiEndpoint(raw);
