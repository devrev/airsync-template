import { OperationOutput } from '@devrev/typescript-sdk/dist/snap-ins';
import request from 'supertest';

import { functionFactory } from '../src/function-factory';
import { app } from './runner';

jest.mock('../src/function-factory', () => ({
  functionFactory: { extraction: jest.fn() },
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  (functionFactory.extraction as jest.Mock).mockReset();
});

test('returns escaped JSON results without advertising Express', async () => {
  const result = '<script>alert("test")</script>&';
  (functionFactory.extraction as jest.Mock).mockResolvedValue(result);
  const response = await request(app).post('/handle/sync').send({ execution_metadata: { function_name: 'extraction', event_type: 'test' } });

  expect(response.status).toBe(200);
  expect(response.headers['x-powered-by']).toBeUndefined();
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
  expect(JSON.parse(response.text)).toEqual({ function_result: result });
  expect(response.text).not.toMatch(/[<>&]/);
});

test('preserves structured errors while escaping reflected function names', async () => {
  const functionName = '<img src=x onerror=alert(1)>';
  const response = await request(app).post('/handle/sync').send({ execution_metadata: { function_name: functionName, event_type: 'test' } });

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/json\b/);
  expect(JSON.parse(response.text).error.err_msg).toBe(`Function ${functionName} not found in factory`);
  expect(response.text).not.toMatch(/[<>]/);
});

test('keeps asynchronous acknowledgements empty without the framework header', async () => {
  (functionFactory.extraction as jest.Mock).mockResolvedValue({ ok: true });
  const response = await request(app).post('/handle/async').send([{ execution_metadata: { function_name: 'extraction', event_type: 'test' } }]);

  expect(response.status).toBe(200);
  expect(response.text).toBe('');
  expect(response.headers['x-powered-by']).toBeUndefined();
});

test.each([
  new Error('private error message'),
  { message: 'private error message', token: 'private-token', stack: '/private/source.ts:42' },
  'private-token',
])('does not return thrown error details to synchronous clients: %p', async (error) => {
  (functionFactory.extraction as jest.Mock).mockRejectedValue(error);
  const response = await request(app).post('/handle/sync').send({
    execution_metadata: { function_name: 'extraction', event_type: 'test' },
  });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    error: { error: 'Function execution failed. See server logs for details.' },
  });
  expect(response.text).not.toMatch(/private error message|private-token|private\/source/);
  expect(console.error).toHaveBeenCalledWith(error);
});

test.each([
  ['OperationMethod_NameEnumSchemaHandler', 2],
  ['OperationMethod_NameEnumExecute', 1],
])('returns a safe operation error for %s', async (operationMethod, serializationFormat) => {
  const error = { message: 'private error message', token: 'private-token' };
  (functionFactory.extraction as jest.Mock).mockRejectedValue(error);
  const response = await request(app).post('/handle/sync').send({
    execution_metadata: {
      function_name: 'extraction',
      event_type: 'test',
      operation_slug: 'test-operation',
      operation_method: operationMethod,
    },
  });

  expect(response.status).toBe(200);
  expect(response.body.function_result.serialization_format).toBe(serializationFormat);
  const bytes = Buffer.from(response.body.function_result.data, 'base64');
  const output = serializationFormat === 2 ? JSON.parse(bytes.toString('utf8')) : OperationOutput.decode(bytes);
  expect(output.error.message).toBe('Function execution failed. See server logs for details.');
  expect(JSON.stringify(output)).not.toMatch(/private error message|private-token/);
  expect(response.body.error).toEqual({ error: 'Function execution failed. See server logs for details.' });
});

test.each([
  ['OperationMethod_NameEnumSchemaHandler', 2],
  ['OperationMethod_NameEnumExecute', 1],
])('preserves successful operation output for %s', async (operationMethod, serializationFormat) => {
  (functionFactory.extraction as jest.Mock).mockResolvedValue(OperationOutput.fromJSON({
    output: { values: [{ ok: true }] },
  }));
  const response = await request(app).post('/handle/sync').send({
    execution_metadata: {
      function_name: 'extraction',
      event_type: 'test',
      operation_slug: 'test-operation',
      operation_method: operationMethod,
    },
  });

  const bytes = Buffer.from(response.body.function_result.data, 'base64');
  const output = serializationFormat === 2 ? JSON.parse(bytes.toString('utf8')) : OperationOutput.decode(bytes);
  expect(output.output.values).toEqual([{ ok: true }]);
  expect(output.error).toBeUndefined();
  expect(response.body.error).toBeUndefined();
});

test.each([
  [undefined, 'FUNCTION_NAME_NOT_PROVIDED', 'Function name not provided in event'],
  ['missing', 'FUNCTION_NOT_FOUND', 'Function missing not found in factory'],
])('preserves structured runtime errors for function %p', async (functionName, errType, errMsg) => {
  const response = await request(app).post('/handle/sync').send({
    execution_metadata: { function_name: functionName, event_type: 'test' },
  });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ error: { err_type: errType, err_msg: errMsg } });
});
