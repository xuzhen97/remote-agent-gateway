/** @file WebSocket 连接管理器
 *
 * 管理与服务端的 WebSocket 长连接，
 * 支持自动重连（指数退避 + 随机抖动）、消息收发、事件回调。
 */
import WebSocket from 'ws';
import type { ClientConfig } from '../config/client.config.js';

/** 消息接收回调类型 */
export type MessageHandler = (data: string) => void;
/** 关闭连接回调类型 */
export type CloseHandler = () => void;
/** 连接回调类型（isReconnect 表示是否为重连） */
export type ConnectHandler = (isReconnect: boolean) => void;

/**
 * WebSocket 连接管理器
 *
 * 特性：
 * - 自动重连（指数退避，最大 30 秒，±25% 随机抖动）
 * - 首次连接与重连区分（通过回调的 isReconnect 参数）
 * - 优雅关闭
 */
export class ConnectionManager {
  private ws: WebSocket | null = null;
  private config: ClientConfig;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private connectHandler: ConnectHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private connected = false;
  private firstConnectDone = false;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  /** 注册消息接收回调 */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** 注册连接关闭回调 */
  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  /** 注册连接建立回调（包括重连） */
  onConnect(handler: ConnectHandler): void {
    this.connectHandler = handler;
  }

  /**
   * 建立 WebSocket 连接
   * URL 格式: ws://server:port/ws/client?clientId=xxx&token=xxx
   */
  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    const url = `${this.config.serverUrl}?clientId=${encodeURIComponent(this.config.clientId)}&token=${encodeURIComponent(this.config.token)}`;

    this.ws = new WebSocket(url);

    // 连接建立事件
    this.ws.on('open', () => {
      this.connected = true;
      const isReconnect = this.firstConnectDone;
      this.firstConnectDone = true;
      this.reconnectAttempts = 0;
      console.log(`已连接服务端: ${this.config.serverUrl}${isReconnect ? ' (重连)' : ''}`);
      if (this.connectHandler) this.connectHandler(isReconnect);
    });

    // 接收消息事件
    this.ws.on('message', (data: Buffer) => {
      if (this.messageHandler) {
        this.messageHandler(data.toString());
      }
    });

    // 连接关闭事件 — 触发自动重连
    this.ws.on('close', () => {
      this.connected = false;
      if (this.closeHandler) this.closeHandler();
      this.scheduleReconnect();
    });

    // 连接错误事件
    this.ws.on('error', (err: Error) => {
      console.error('WebSocket 错误:', err.message);
      this.ws?.close();
    });
  }

  /**
   * 发送 JSON 消息到服务端
   * @returns 是否发送成功
   */
  send(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 断开连接（取消重连定时器后关闭）
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }

  /**
   * 排定自动重连
   * 使用指数退避（2^n 秒）配合随机抖动（±25%），最大 30 秒
   */
  private scheduleReconnect(): void {
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    // 添加 ±25% 随机抖动，避免多个客户端同时重连导致 thundering herd
    const jitter = baseDelay * (0.5 + Math.random() * 0.5);
    const delay = Math.round(jitter);
    this.reconnectAttempts++;

    console.log(`将在 ${delay}ms 后重连（第 ${this.reconnectAttempts} 次，最大退避 30s）`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
