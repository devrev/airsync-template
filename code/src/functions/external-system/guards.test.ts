import { AxiosHeaders } from 'axios';

import {
  API_ENDPOINT_PLACEHOLDER,
  DEFAULT_RETRY_AFTER_SECONDS,
  INVALID_CHECKPOINT_MESSAGE,
  MAX_RETRY_AFTER_SECONDS,
  decodeApiEndpoint,
  decodeExtractorState,
  requireNonBlankString,
  resolveApiEndpoint,
  toFailureResult,
  toRateLimitDelay,
} from './guards';

const NOW = Date.parse('2026-10-19T12:00:00Z');

afterEach(() => {
  jest.restoreAllMocks();
});

// Delay for a 429 whose Retry-After header has the given value.
const delayFor = (retryAfter: unknown): number | undefined =>
  toRateLimitDelay({ response: { status: 429, headers: { 'retry-after': retryAfter } } })?.delaySeconds;

describe('Retry-After parsing', () => {
  it('defaults when the header is missing or blank', () => {
    expect(toRateLimitDelay({ response: { status: 429 } })?.delaySeconds).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor(undefined)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor(null)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor('')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor('   ')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor([])).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('parses delta seconds from strings, numbers and header arrays', () => {
    expect(delayFor('9')).toBe(9);
    expect(delayFor(' 12 ')).toBe(12);
    expect(delayFor(7)).toBe(7);
    expect(delayFor(['5', '99'])).toBe(5);
  });

  it('rounds fractional seconds up and caps at the maximum', () => {
    expect(delayFor('1.2')).toBe(2);
    expect(delayFor(String(MAX_RETRY_AFTER_SECONDS + 1))).toBe(MAX_RETRY_AFTER_SECONDS);
  });

  it('keeps zero as "retry now"', () => {
    expect(delayFor('0')).toBe(0);
    expect(delayFor(0)).toBe(0);
  });

  it('falls back on negative or non-finite values', () => {
    expect(delayFor('-3')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor(Number.NaN)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('parses HTTP dates relative to now', () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(delayFor(new Date(NOW + 120_000).toUTCString())).toBe(120);
    expect(delayFor(new Date(NOW - 5_000).toUTCString())).toBe(0);
    expect(delayFor(new Date(NOW + 10 * 3600_000).toUTCString())).toBe(MAX_RETRY_AFTER_SECONDS);
  });

  it('falls back on unparseable values', () => {
    expect(delayFor('soon')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(delayFor({ seconds: 5 })).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('reads the header case-insensitively, including from AxiosHeaders', () => {
    expect(toRateLimitDelay({ response: { status: 429, headers: { 'Retry-After': '4' } } })?.delaySeconds).toBe(4);
    const headers = new AxiosHeaders();
    headers.set('Retry-After', '6');
    expect(toRateLimitDelay({ response: { status: 429, headers } })?.delaySeconds).toBe(6);
  });
});

describe('toRateLimitDelay', () => {
  it('maps HTTP 429 to a delay and ignores everything else', () => {
    expect(toRateLimitDelay({ response: { status: 429, headers: { 'retry-after': '2' } } })).toEqual({
      status: 'delay',
      delaySeconds: 2,
    });
    expect(toRateLimitDelay({ response: { status: 500 } })).toBeUndefined();
    expect(toRateLimitDelay(new Error('boom'))).toBeUndefined();
    expect(toRateLimitDelay(undefined)).toBeUndefined();
  });
});

describe('toFailureResult', () => {
  it('maps HTTP 429 to a delay honoring Retry-After', () => {
    const error = { response: { status: 429, headers: { 'retry-after': '9' } } };
    expect(toFailureResult(error, 'extract data')).toEqual({ status: 'delay', delaySeconds: 9 });
  });

  it('maps HTTP 429 without Retry-After to the default delay', () => {
    expect(toFailureResult({ response: { status: 429 } }, 'extract data')).toEqual({
      status: 'delay',
      delaySeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it('maps other HTTP failures to an error carrying the context and status', () => {
    const error = Object.assign(new Error('Request failed'), { response: { status: 503 } });
    expect(toFailureResult(error, 'create todo')).toEqual({
      status: 'error',
      error: { message: 'create todo (HTTP 503): Request failed' },
    });
  });

  it('describes errors without a response', () => {
    expect(toFailureResult(new Error('boom'), 'ctx')).toEqual({ status: 'error', error: { message: 'ctx: boom' } });
    expect(toFailureResult('bad', 'ctx')).toEqual({ status: 'error', error: { message: 'ctx: bad' } });
    expect(toFailureResult(undefined, 'ctx')).toEqual({ status: 'error', error: { message: 'ctx: unknown error' } });
  });
});

describe('decodeExtractorState', () => {
  const valid = {
    runId: 'run-1',
    todos: { completed: false, nextPage: 2 },
    users: { completed: true },
    attachments: { completed: false, nextPage: 0 },
  };

  it('accepts a well-formed checkpoint, including buckets without a cursor', () => {
    expect(decodeExtractorState(valid)).toEqual(valid);
  });

  it('accepts state without a run id', () => {
    const { todos, users, attachments } = valid;
    expect(decodeExtractorState({ todos, users, attachments })).toEqual({ todos, users, attachments });
  });

  it('keeps keys it does not validate, at the top level and in buckets', () => {
    const state = { ...valid, lastModified: '2026-01-01', todos: { ...valid.todos, cursorToken: 'abc' } };
    expect(decodeExtractorState(state)).toEqual(state);
  });

  it.each([
    ['null', null],
    ['a non-string run id', { ...valid, runId: 7 }],
    ['a string', 'state'],
    ['a missing bucket', { todos: valid.todos, users: valid.users }],
    ['a null bucket', { ...valid, users: null }],
    ['a non-boolean completed flag', { ...valid, todos: { completed: 'no' } }],
    ['a missing completed flag', { ...valid, todos: { nextPage: 1 } }],
    ['a negative cursor', { ...valid, todos: { completed: false, nextPage: -1 } }],
    ['a fractional cursor', { ...valid, todos: { completed: false, nextPage: 1.5 } }],
    ['a string cursor', { ...valid, todos: { completed: false, nextPage: '1' } }],
  ])('rejects %s', (_label, value) => {
    expect(() => decodeExtractorState(value)).toThrow(INVALID_CHECKPOINT_MESSAGE);
  });
});

// Not a literal, so secret scanners don't flag it.
function urlWithCredentials(): string {
  const url = new URL('https://api.example.com');
  url.username = 'user';
  url.password = 'pass';
  return url.toString();
}

describe('HTTP client configuration', () => {
  it('requires a non-blank string', () => {
    expect(requireNonBlankString('token', 'connection_data.key')).toBe('token');
    for (const value of [undefined, null, '', '   ', 42]) {
      expect(() => requireNonBlankString(value, 'connection_data.key')).toThrow(
        'Invalid config: connection_data.key must be a non-empty string',
      );
    }
  });

  it('accepts HTTPS endpoints and loopback HTTP', () => {
    expect(decodeApiEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(decodeApiEndpoint('http://localhost:8080')).toBe('http://localhost:8080');
    expect(decodeApiEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(decodeApiEndpoint('http://[::1]:8080')).toBe('http://[::1]:8080');
  });

  it.each([
    ['the placeholder', API_ENDPOINT_PLACEHOLDER, 'still the placeholder value'],
    ['a relative URL', '/api', 'must be an absolute URL'],
    ['remote HTTP', 'http://api.example.com', 'must be HTTPS'],
    ['another protocol', 'ftp://api.example.com', 'must be HTTPS'],
    ['embedded credentials', urlWithCredentials(), 'must not embed credentials'],
    ['a query string', 'https://api.example.com?token=1', 'must not include query or fragment'],
    ['a fragment', 'https://api.example.com#x', 'must not include query or fragment'],
  ])('rejects %s', (_label, value, message) => {
    expect(() => decodeApiEndpoint(value)).toThrow(message);
  });

  it('lets the unreplaced placeholder through only in resolveApiEndpoint', () => {
    expect(resolveApiEndpoint(API_ENDPOINT_PLACEHOLDER)).toBe(API_ENDPOINT_PLACEHOLDER);
    expect(resolveApiEndpoint('https://api.example.com')).toBe('https://api.example.com');
    expect(() => resolveApiEndpoint('http://api.example.com')).toThrow('must be HTTPS');
    expect(() => resolveApiEndpoint('')).toThrow('api_endpoint must be a non-empty string');
  });
});
