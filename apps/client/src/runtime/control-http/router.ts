/** @file 客户端 HTTP 控制路由
 *
 * 轻量级 HTTP 路由器，支持方法 + 正则路径匹配。
 * 不使用第三方框架，保持打包体积最小。
 *
 * 路由注册示例：
 *   router.add('GET', /^\/ping$/, handler)
 *   router.add('POST', /^\/jobs\/command$/, handler)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** 路由处理器类型 */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

/** 路由条目 */
interface Route { method: string; path: RegExp; handler: RouteHandler }

/** 简单 HTTP 路由器 */
export class ControlHttpRouter {
  /** 路由表 */
  private readonly routes: Route[] = [];

  /**
   * 注册路由
   * @param method - HTTP 方法（GET, POST, PUT, DELETE）
   * @param path - 路径正则
   * @param handler - 请求处理器
   */
  add(method: string, path: RegExp, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  /**
   * 处理 HTTP 请求
   * @returns 是否找到匹配的路由
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = this.routes.find((candidate) =>
      candidate.method === (req.method ?? 'GET') && candidate.path.test(url.pathname));
    if (!route) return false;
    await route.handler(req, res, url);
    return true;
  }
}
