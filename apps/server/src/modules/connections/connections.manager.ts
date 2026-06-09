/** @file WebSocket 连接池管理器
 *
 * 管理所有客户端 WebSocket 长连接。
 * 提供注册、移除、查询和推送消息功能。
 */
import type { WebSocket } from 'ws';

/** 客户端连接信息 */
interface ClientConnection {
  /** 客户端唯一标识 */
  clientId: string;
  /** WebSocket 连接实例 */
  ws: WebSocket;
  /** 连接建立时间 */
  connectedAt: number;
}

/**
 * 连接管理器
 * 维护 clientId → WebSocket 的映射，处理重复连接和老连接关闭。
 */
class ConnectionManager {
  /** clientId → ClientConnection 映射 */
  private connections = new Map<string, ClientConnection>();

  /**
   * 注册客户端的 WebSocket 连接
   * 如果该客户端已有连接，先关闭旧连接再注册新连接。
   */
  register(clientId: string, ws: WebSocket): void {
    // 关闭该客户端已有的旧连接
    const existing = this.connections.get(clientId);
    if (existing) {
      existing.ws.close(4001, '已被新连接替换');
    }

    this.connections.set(clientId, { clientId, ws, connectedAt: Date.now() });
  }

  /** 移除客户端的连接记录 */
  remove(clientId: string): void {
    this.connections.delete(clientId);
  }

  /** 获取客户端的连接信息 */
  get(clientId: string): ClientConnection | undefined {
    return this.connections.get(clientId);
  }

  /** 检查客户端是否在线 */
  isOnline(clientId: string): boolean {
    return this.connections.has(clientId);
  }

  /** 获取所有在线连接 */
  getAll(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  /** 获取所有在线客户端 ID */
  getOnlineClientIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * 向指定客户端发送消息
   * @returns 是否发送成功（可能客户端已离线）
   */
  sendToClient(clientId: string, message: unknown): boolean {
    const conn = this.connections.get(clientId);
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
      return false;
    }
    conn.ws.send(JSON.stringify(message));
    return true;
  }
}

/** 全局连接管理器单例 */
export const connectionManager = new ConnectionManager();
