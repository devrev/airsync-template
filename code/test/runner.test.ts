import { once } from 'events';
import { request, Server } from 'http';
import { AddressInfo } from 'net';

import { functionFactory } from '../src/function-factory';
import { startServer } from './runner';

jest.mock('../src/function-factory', () => ({
  functionFactory: { extraction: jest.fn() },
}));

let server: Server;

function post(path: string, body: unknown) {
  return new Promise<{ status: number | undefined; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  server = startServer(0);
  await once(server, 'listening');
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  jest.restoreAllMocks();
});

beforeEach(() => {
  (functionFactory.extraction as jest.Mock).mockReset();
});

test('returns escaped JSON results without advertising Express', async () => {
  const result = '<script>alert("test")</script>&';
  (functionFactory.extraction as jest.Mock).mockResolvedValue(result);
  const response = await post('/handle/sync', { execution_metadata: { function_name: 'extraction', event_type: 'test' } });

  expect(response.status).toBe(200);
  expect(response.headers['x-powered-by']).toBeUndefined();
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
  expect(JSON.parse(response.text)).toEqual({ function_result: result });
  expect(response.text).not.toMatch(/[<>&]/);
});

test('preserves structured errors while escaping reflected function names', async () => {
  const functionName = '<img src=x onerror=alert(1)>';
  const response = await post('/handle/sync', { execution_metadata: { function_name: functionName, event_type: 'test' } });

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
  expect(JSON.parse(response.text).error.err_msg).toBe(`Function ${functionName} not found in factory`);
  expect(response.text).not.toMatch(/[<>]/);
});

test('keeps asynchronous acknowledgements empty without the framework header', async () => {
  (functionFactory.extraction as jest.Mock).mockResolvedValue({ ok: true });
  const response = await post('/handle/async', [{ execution_metadata: { function_name: 'extraction', event_type: 'test' } }]);

  expect(response.status).toBe(200);
  expect(response.text).toBe('');
  expect(response.headers['x-powered-by']).toBeUndefined();
});
