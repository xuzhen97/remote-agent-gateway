/** @file WebSocket 控制面协议定义
 *
 * 客户端 ←→ 服务端之间的 WebSocket 消息格式。
 * 数据面流量（任务执行、文件管理、FRP 映射）通过 client HTTP 直接访问，
 * 不经过 WebSocket 控制面。
 */
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

/** 客户端 → 服务端消息类型 */
export type ClientMessageType =
  | 'client.register'        // 客户端注册
  | 'client.heartbeat'       // 心跳
  | 'client.http_ready'      // HTTP 控制面就绪
  | 'client.http_failed'     // HTTP 控制面启动失败
  | 'client.transfer.progress'  // 传输进度上报
  | 'client.transfer.complete'  // 传输完成上报
  | 'client.transfer.failed';   // 传输失败上报

/** 服务端 → 客户端消息类型 */
export type ServerMessageType =
  | 'server.ack'     // 确认响应
  | 'server.error'   // 错误信息
  | 'transfer.download.start';  // 通知客户端开始下载

/**
 * WebSocket 消息通用结构
 * @template T - 消息类型字符串
 * @template P - 消息负载类型
 */
export interface WsMessage<T extends string, P = unknown> {
  /** 消息类型 */
  type: T;
  /** 请求 ID（用于关联请求和响应） */
  requestId?: string;
  /** 消息负载 */
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

/**
 * 服务端 ACK 响应负载
 * @description 客户端注册成功后，服务端返回确认信息以及 FRP/HTTP 控制面配置
 */
export interface ServerAckPayload {
  /** 确认消息 */
  message: string;
  /** FRP 连接配置（让客户端连接 frps） */
  frp?: { serverAddr: string; serverPort: number; authToken: string };
  /** HTTP 控制面协调信息 */
  httpControl?: ClientHttpControl;
}

/** 服务端确认消息类型 */
export type ServerAckMessage = WsMessage<'server.ack', ServerAckPayload>;
/** 服务端错误消息类型 */
export type ServerErrorMessage = WsMessage<'server.error', { code: string; message: string }>;

/** 服务端 → 客户端的所有消息类型联合 */
export type ServerMessage =
  | ServerAckMessage
  | ServerErrorMessage
  | ServerTransferDownloadStartMessage;
