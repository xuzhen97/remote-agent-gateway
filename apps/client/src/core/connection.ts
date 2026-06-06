import WebSocket from 'ws';
import type { ClientConfig } from '../config/client.config.js';

export type MessageHandler = (data: string) => void;
export type CloseHandler = () => void;
export type ConnectHandler = (isReconnect: boolean) => void;

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

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  onConnect(handler: ConnectHandler): void {
    this.connectHandler = handler;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    const url = `${this.config.serverUrl}?clientId=${encodeURIComponent(this.config.clientId)}&token=${encodeURIComponent(this.config.token)}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      const isReconnect = this.firstConnectDone;
      this.firstConnectDone = true;
      this.reconnectAttempts = 0;
      console.log(`Connected to server: ${this.config.serverUrl}${isReconnect ? ' (reconnect)' : ''}`);
      if (this.connectHandler) this.connectHandler(isReconnect);
    });

    this.ws.on('message', (data: Buffer) => {
      if (this.messageHandler) {
        this.messageHandler(data.toString());
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (this.closeHandler) this.closeHandler();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('WebSocket error:', err.message);
      this.ws?.close();
    });
  }

  send(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    // Add ±25% jitter to avoid thundering herd
    const jitter = baseDelay * (0.5 + Math.random() * 0.5);
    const delay = Math.round(jitter);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}, max backoff 30s)`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
