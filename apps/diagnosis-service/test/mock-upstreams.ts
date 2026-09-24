import { createHash } from 'crypto';
import { AddressInfo } from 'net';
import { IncomingMessage, Server, ServerResponse, createServer } from 'http';

export interface ChatRequest {
  messages: { role: string; content: string }[];
}

// One local HTTP server impersonating every upstream the diagnosis
// pipeline talks to: OpenAI (chat + embeddings), Loki, Prometheus and a
// dependency health endpoint. Tests swap `chatHandler` per scenario.
export class MockUpstreams {
  server: Server;
  url = '';
  chatHandler: (req: ChatRequest) => unknown = () => ({});
  chatRequests: ChatRequest[] = [];
  logLines: string[] = [];

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => resolve(data));
    });
    const path = (req.url ?? '').split('?')[0];
    const json = (status: number, payload: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (path === '/v1/chat/completions') {
      const parsed = JSON.parse(body) as ChatRequest;
      this.chatRequests.push(parsed);
      return json(200, {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4o-2024-08-06',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(this.chatHandler(parsed)) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
      });
    }
    if (path === '/v1/embeddings') {
      // Deterministic: same alert text → same unit vector.
      const { input } = JSON.parse(body) as { input: string };
      const hot = createHash('sha256').update(input).digest().readUInt16BE(0) % 1536;
      const embedding = new Array<number>(1536).fill(0);
      embedding[hot] = 1;
      return json(200, {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding }],
        model: 'x',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
    }
    if (path === '/loki/api/v1/query_range') {
      const now = Date.now();
      return json(200, {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { service: 'auth-service' },
              values: this.logLines.map((l, i) => [
                `${now - (this.logLines.length - i) * 1000}000000`,
                l,
              ]),
            },
          ],
        },
      });
    }
    if (path === '/api/v1/query_range') {
      const end = Math.floor(Date.now() / 1000);
      const values = Array.from({ length: 30 }, (_, i) => [
        end - (30 - i) * 60,
        i < 25 ? '0.31' : '0.94',
      ]);
      return json(200, {
        status: 'success',
        data: { resultType: 'matrix', result: [{ metric: {}, values }] },
      });
    }
    if (path === '/health/payments') {
      return json(503, { status: 'down' });
    }
    return json(404, { error: 'not found' });
  }
}
