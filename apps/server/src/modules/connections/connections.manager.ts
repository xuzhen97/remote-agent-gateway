import type { WebSocket } from 'ws';

interface ClientConnection {
  clientId: string;
  ws: WebSocket;
  connectedAt: number;
}

class ConnectionManager {
  private connections = new Map<string, ClientConnection>();

  register(clientId: string, ws: WebSocket): void {
    // Close existing connection if any
    const existing = this.connections.get(clientId);
    if (existing) {
      existing.ws.close(4001, 'Replaced by new connection');
    }

    this.connections.set(clientId, { clientId, ws, connectedAt: Date.now() });
  }

  remove(clientId: string): void {
    this.connections.delete(clientId);
  }

  get(clientId: string): ClientConnection | undefined {
    return this.connections.get(clientId);
  }

  isOnline(clientId: string): boolean {
    return this.connections.has(clientId);
  }

  getAll(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  getOnlineClientIds(): string[] {
    return Array.from(this.connections.keys());
  }

  sendToClient(clientId: string, message: unknown): boolean {
    const conn = this.connections.get(clientId);
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
      return false;
    }
    conn.ws.send(JSON.stringify(message));
    return true;
  }
}

export const connectionManager = new ConnectionManager();
