import { createServer, type Server } from 'node:http';
import { createClient } from 'dalux-build-api';

const API_KEY = 'SECRET-DALUX-KEY-123';
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'boom' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/service/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('Dalux client errors', () => {
  // Tool errors are returned to the caller as text, so they must not carry the connection's API key.
  it('do not contain the API key', async () => {
    const client = createClient({ baseUrl, apiKey: API_KEY });
    const error = await client.projects.listProjects().then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error).toBeDefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(API_KEY);
  });
});
