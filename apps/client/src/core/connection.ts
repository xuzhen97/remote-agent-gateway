import WebSocket from 'ws';
import type { ClientConfig } from '../config/client.config.js';

export type MessageHandler = (data: string) => void;
export type CloseHandler = () => void;

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private config: ClientConfig;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private connected = false;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    const url = `${this.config.serverUrl}?clientId=${encodeURIComponent(this.config.clientId)}&token=${encodeURIComponent(this.config.token)}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log(`Connected to server: ${this.config.serverUrl}`);
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
    this.maxReconnectAttempts = 0; // prevent reconnect
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
