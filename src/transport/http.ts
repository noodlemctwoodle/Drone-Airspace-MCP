import type { Server as HttpServer } from 'node:http';
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../core/logger.js';
import type { MCPTransport } from './index.js';
import { ICON_PNG_180, ICON_SVG, WEB_MANIFEST } from '../map/icon.js';

export interface ExtraRoutes {
  mapHtml?: (origin: string) => string;
  viewData?: (params: URLSearchParams) => Promise<unknown>;
  windData?: (params: URLSearchParams) => Promise<unknown>;
  droneIndex?: () => unknown;
  geocode?: (params: URLSearchParams) => Promise<unknown>;
  donate?: (kind: 'once' | 'monthly', quantity?: number) => Promise<{ clientSecret: string } | { error: string; status: number }>;
}

export interface HealthInfo {
  version: string;
  pack: unknown;
  notamCacheAgeSeconds: number | null;
}

export class StreamableHttpTransport implements MCPTransport {
  private httpServer: HttpServer | undefined;
  public port: number;

  constructor(
    private readonly createServer: () => McpServer,
    private readonly logger: Logger,
    port: number,
    private readonly health: () => HealthInfo,
    private readonly host = '0.0.0.0',
    private readonly extra: ExtraRoutes = {}
  ) {
    this.port = port;
  }

  async start(): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    app.get('/healthz', (_req, res) => {
      res.json({ ok: true, ...this.health() });
    });
    if (this.extra.mapHtml) {
      const html = this.extra.mapHtml;
      app.get('/icon.svg', (_req, res) => { res.type('image/svg+xml').set('cache-control', 'public, max-age=604800').send(ICON_SVG); });
      app.get('/icon-180.png', (_req, res) => { res.type('image/png').set('cache-control', 'public, max-age=604800').send(Buffer.from(ICON_PNG_180)); });
      app.get('/manifest.webmanifest', (req, res) => { res.type('application/manifest+json').send(WEB_MANIFEST(`${req.protocol}://${req.get('host')}`)); });
      app.get('/map', (req, res) => {
        res.type('html').send(html(`${req.protocol}://${req.get('host')}`));
      });
    }
    if (this.extra.viewData) {
      const view = this.extra.viewData;
      app.get('/api/view', async (req, res) => {
        res.set('access-control-allow-origin', '*');
        try {
          const params = new URLSearchParams(req.query as Record<string, string>);
          const data = await view(params);
          if (data === undefined) res.status(400).json({ error: 'lat and lon query parameters are required' });
          else res.json(data);
        } catch (error) {
          res.status(503).json({ error: (error as Error).message });
        }
      });
    }

    if (this.extra.windData) {
      const wind = this.extra.windData;
      app.get('/api/wind', async (req, res) => {
        res.set('access-control-allow-origin', '*');
        try {
          const data = await wind(new URLSearchParams(req.query as Record<string, string>));
          if (data === undefined) res.status(400).json({ error: 'bbox=w,s,e,n and z query parameters are required' });
          else res.json(data);
        } catch (error) {
          res.status(503).json({ error: (error as Error).message });
        }
      });
    }

    if (this.extra.geocode) {
      const geocode = this.extra.geocode;
      app.get('/api/geocode', async (req, res) => {
        res.set('access-control-allow-origin', '*');
        try {
          const data = await geocode(new URLSearchParams(req.query as Record<string, string>));
          if (data === undefined) res.status(400).json({ error: 'q query parameter is required' });
          else res.json(data);
        } catch (error) {
          res.status(503).json({ error: (error as Error).message });
        }
      });
    }

    if (this.extra.donate) {
      const donate = this.extra.donate;
      app.post('/api/donate', express.json(), async (req, res) => {
        res.set('access-control-allow-origin', '*');
        const body = (req.body ?? {}) as { kind?: string; quantity?: number };
        const r = await donate(body.kind === 'monthly' ? 'monthly' : 'once', typeof body.quantity === 'number' ? body.quantity : undefined);
        if ('error' in r) res.status(r.status).json({ error: r.error });
        else res.set('cache-control', 'no-store').json(r);
      });
    }

    if (this.extra.droneIndex) {
      const drones = this.extra.droneIndex;
      app.get('/api/drones', (_req, res) => {
        res.set('access-control-allow-origin', '*');
        res.set('cache-control', 'public, max-age=86400');
        res.json(drones());
      });
    }

    // Stateless: a fresh server + transport per request, no session ids.
    app.post('/mcp', async (req: Request, res: Response) => {
      const server = this.createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        this.logger.error(`mcp request failed: ${(error as Error).message}`);
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
      }
    });

    const methodNotAllowed = (_req: Request, res: Response) => {
      res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    };
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);

    await new Promise<void>((resolve, reject) => {
      this.httpServer = app.listen(this.port, this.host, () => resolve());
      this.httpServer.on('error', reject);
    });
    const address = this.httpServer?.address();
    if (address && typeof address === 'object') this.port = address.port;
    this.logger.info(`listening on http://${this.host}:${this.port}/mcp`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
    });
  }
}
