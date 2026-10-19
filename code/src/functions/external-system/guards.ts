import type { ErrorRecord } from '@devrev/airsync-sdk';

import type { ExtractorState } from '../extraction';

export const API_ENDPOINT_PLACEHOLDER = '<REPLACE_WITH_API_ENDPOINT>';
export const DEFAULT_RETRY_AFTER_SECONDS = 60;
export const MAX_RETRY_AFTER_SECONDS = 3600;
export const MAX_PAGES_PER_INVOCATION = 10;
export const INVALID_CHECKPOINT_MESSAGE = 'Invalid extraction checkpoint';

type RateLimitDelay = { status: 'delay'; delaySeconds: number };

export type FailureResult = RateLimitDelay | { status: 'error'; error: ErrorRecord };

// 0 means "retry now".
const clampRetryAfter = (seconds: number): number =>
  seconds >= 0 ? Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS) : DEFAULT_RETRY_AFTER_SECONDS;

const retryAfterFromText = (text: string): number => {
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    return clampRetryAfter(asNumber);
  }
  const asDate = Date.parse(text);
  if (Number.isFinite(asDate)) {
    return clampRetryAfter(Math.max(0, (asDate - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
};

// Retry-After as delta seconds or an HTTP date.
const parseRetryAfter = (headerValue: unknown): number => {
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

const readResponseHeader = (error: unknown, name: string): unknown => {
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

export const toRateLimitDelay = (error: unknown): RateLimitDelay | undefined =>
  readHttpStatus(error) === 429
    ? { status: 'delay', delaySeconds: parseRetryAfter(readResponseHeader(error, 'retry-after')) }
    : undefined;

export const toFailureResult = (error: unknown, context: string): FailureResult => {
  const delay = toRateLimitDelay(error);
  if (delay) {
    return delay;
  }
  const status = readHttpStatus(error);
  const statusPart = status !== undefined ? ` (HTTP ${status})` : '';
  return { status: 'error', error: { message: `${context}${statusPart}: ${describeError(error)}` } };
};

type ExtractorBucket = ExtractorState['todos'];

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const decodeBucket = (value: unknown): ExtractorBucket => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  const bucket = value as Record<string, unknown>;
  const { completed, nextPage } = bucket;
  if (typeof completed !== 'boolean' || (nextPage !== undefined && !isNonNegativeInteger(nextPage))) {
    throw new Error(INVALID_CHECKPOINT_MESSAGE);
  }
  return { ...bucket, completed, nextPage };
};

// Unvalidated keys are kept.
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

// Lets the template placeholder through until a real endpoint is wired.
export const resolveApiEndpoint = (raw: unknown): string =>
  raw === API_ENDPOINT_PLACEHOLDER ? API_ENDPOINT_PLACEHOLDER : decodeApiEndpoint(raw);
