import type {
  ClientInfo,
  ClientHttpControl,
  ClientHttpReadyPayload,
  ClientHttpFailedPayload,
  ServerTransferDownloadStartPayload,
  ClientTransferProgressPayload,
  ClientTransferCompletePayload,
  ClientTransferFailedPayload,
} from './types.js';

export type ClientMessageType =
  | 'client.register'
  | 'client.heartbeat'
  | 'client.http_ready'
  | 'client.http_failed'
  | 'client.transfer.progress'
  | 'client.transfer.complete'
  | 'client.transfer.failed';

export type ServerMessageType =
  | 'server.ack'
  | 'server.error'
  | 'transfer.download.start';

export interface WsMessage<T extends string, P = unknown> {
  type: T;
  requestId?: string;
  payload: P;
}

export type ClientRegisterMessage = WsMessage<'client.register', ClientInfo>;

export type ClientHeartbeatMessage = WsMessage<
  'client.heartbeat',
  {
    clientId: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
  }
>;

export type ClientHttpReadyMessage = WsMessage<'client.http_ready', ClientHttpReadyPayload>;
export type ClientHttpFailedMessage = WsMessage<'client.http_failed', ClientHttpFailedPayload>;

export type ServerTransferDownloadStartMessage = WsMessage<'transfer.download.start', ServerTransferDownloadStartPayload>;
export type ClientTransferProgressMessage = WsMessage<'client.transfer.progress', ClientTransferProgressPayload>;
export type ClientTransferCompleteMessage = WsMessage<'client.transfer.complete', ClientTransferCompletePayload>;
export type ClientTransferFailedMessage = WsMessage<'client.transfer.failed', ClientTransferFailedPayload>;

export type ClientMessage =
  | ClientRegisterMessage
  | ClientHeartbeatMessage
  | ClientHttpReadyMessage
  | ClientHttpFailedMessage
  | ClientTransferProgressMessage
  | ClientTransferCompleteMessage
  | ClientTransferFailedMessage;

export interface ServerAckPayload {
  message: string;
  frp?: { serverAddr: string; serverPort: number; authToken: string };
  httpControl?: ClientHttpControl;
}

export type ServerAckMessage = WsMessage<'server.ack', ServerAckPayload>;
export type ServerErrorMessage = WsMessage<'server.error', { code: string; message: string }>;

export type ServerMessage =
  | ServerAckMessage
  | ServerErrorMessage
  | ServerTransferDownloadStartMessage;
