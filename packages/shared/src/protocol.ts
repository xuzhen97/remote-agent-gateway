import type {
  ClientInfo,
  TaskType,
  TaskStatus,
  TaskPayloadMap,
} from './types.js';

// WebSocket message types
export type ClientMessageType =
  | 'client.register'
  | 'client.heartbeat'
  | 'client.http_ready'
  | 'client.http_failed'
  | 'task.log'
  | 'task.result';

export type ServerMessageType =
  | 'server.ack'
  | 'server.error'
  | 'task.dispatch';

// Base message envelope
export interface WsMessage<T extends string, P = unknown> {
  type: T;
  requestId?: string;
  payload: P;
}

// Client → Server messages
export type ClientRegisterMessage = WsMessage<
  'client.register',
  ClientInfo
>;

export type ClientHeartbeatMessage = WsMessage<
  'client.heartbeat',
  {
    clientId: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
  }
>;

export type TaskLogMessage = WsMessage<
  'task.log',
  {
    taskId: string;
    stream: 'stdout' | 'stderr';
    content: string;
  }
>;

export type TaskResultMessage = WsMessage<
  'task.result',
  {
    taskId: string;
    status: TaskStatus;
    result?: unknown;
    error?: string;
  }
>;

export type ClientHttpReadyMessage = WsMessage<
  'client.http_ready',
  import('./types.js').ClientHttpReadyPayload
>;

export type ClientHttpFailedMessage = WsMessage<
  'client.http_failed',
  import('./types.js').ClientHttpFailedPayload
>;

export type ClientMessage =
  | ClientRegisterMessage
  | ClientHeartbeatMessage
  | ClientHttpReadyMessage
  | ClientHttpFailedMessage
  | TaskLogMessage
  | TaskResultMessage;

// Server → Client messages
export interface ServerAckPayload {
  message: string;
  frp?: { serverAddr: string; serverPort: number; authToken: string };
  httpControl?: import('./types.js').ClientHttpControl;
}

export type ServerAckMessage = WsMessage<
  'server.ack',
  ServerAckPayload
>;

export type ServerErrorMessage = WsMessage<
  'server.error',
  { code: string; message: string }
>;

export type TaskDispatchMessage = WsMessage<
  'task.dispatch',
  {
    taskId: string;
    taskType: TaskType;
    payload: TaskPayloadMap[TaskType];
  }
>;

export type ServerMessage =
  | ServerAckMessage
  | ServerErrorMessage
  | TaskDispatchMessage;
