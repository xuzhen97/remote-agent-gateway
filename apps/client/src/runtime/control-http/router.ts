import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

interface Route { method: string; path: RegExp; handler: RouteHandler }

export class ControlHttpRouter {
  private readonly routes: Route[] = [];

  add(method: string, path: RegExp, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = this.routes.find((candidate) =>
      candidate.method === (req.method ?? 'GET') && candidate.path.test(url.pathname));
    if (!route) return false;
    await route.handler(req, res, url);
    return true;
  }
}
