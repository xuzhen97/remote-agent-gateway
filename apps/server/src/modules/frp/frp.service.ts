/** @file FRP 端口映射服务
 *
 * 管理服务端数据库中存储的端口映射记录（CRUD 操作）。
 * 实际的 FRP 代理创建/删除由客户端通过 client HTTP API 执行。
 */
import { getDb } from '../../db/index.js';
import { v4 as uuid } from 'uuid';
import { env, resolveFrpsHost, buildFrpPublicUrl } from '../../config/env.js';
import { portAllocatorService } from '../ports/port-allocator.service.js';

/** 数据库中的端口映射行记录 */
export interface PortMappingRow {
  id: string;
  client_id: string;
  name: string;
  proxy_type: string;
  local_ip: string;
  local_port: number;
  remote_port: number | null;
  custom_domain: string | null;
  status: string;
  public_url: string | null;
  created_at: number;
  updated_at: number;
}

/** 端口映射服务 */
export class FrpService {
  /**
   * 创建端口映射
   * 自动分配远程端口，生成公网 URL。
   */
  async createMapping(params: {
    clientId: string;
    name: string;
    proxyType: string;
    localIp: string;
    localPort: number;
    remotePort?: number;
    customDomain?: string;
  }): Promise<PortMappingRow> {
    const db = getDb();
    const id = `pm_${uuid().slice(0, 8)}`;
    const now = Date.now();

    const reserveMappingRow = (remotePort: number, clientId: string): void => {
      const publicUrl = buildFrpPublicUrl(remotePort, {
        proxyType: params.proxyType as 'tcp' | 'http' | 'https',
        customDomain: params.customDomain,
      });

      db.run(
        `INSERT INTO port_mappings (id, client_id, name, proxy_type, local_ip, local_port, remote_port, custom_domain, status, public_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, ?, ?)`,
        [id, clientId, params.name, params.proxyType, params.localIp, params.localPort, remotePort, params.customDomain ?? null, publicUrl, now, now],
      );
    };

    await portAllocatorService.allocate(
      params.clientId,
      typeof params.remotePort === 'number'
        ? { preferredPort: params.remotePort, reserve: reserveMappingRow }
        : { reserve: reserveMappingRow },
    );

    return this.getMapping(id)!;
  }

  /** 获取单个映射记录 */
  getMapping(mappingId: string): PortMappingRow | undefined {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM port_mappings WHERE id = ?');
    stmt.bind([mappingId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as PortMappingRow;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  /**
   * 列出端口映射
   * @param clientId - 可选，筛选特定客户端的映射
   */
  listMappings(clientId?: string): PortMappingRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM port_mappings';
    const params: unknown[] = [];

    if (clientId) {
      sql += ' WHERE client_id = ?';
      params.push(clientId);
    }

    sql += ' ORDER BY created_at DESC';

    const results: PortMappingRow[] = [];
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as PortMappingRow);
    }
    stmt.free();
    return results;
  }

  /** 更新映射状态 */
  updateMappingStatus(mappingId: string, status: string, publicUrl?: string): void {
    const db = getDb();
    const now = Date.now();
    if (publicUrl) {
      db.run('UPDATE port_mappings SET status = ?, public_url = ?, updated_at = ? WHERE id = ?', [status, publicUrl, now, mappingId]);
    } else {
      db.run('UPDATE port_mappings SET status = ?, updated_at = ? WHERE id = ?', [status, now, mappingId]);
    }
  }

  /**
   * 删除映射记录并释放远程端口
   */
  deleteMapping(mappingId: string): void {
    const db = getDb();
    const mapping = this.getMapping(mappingId);
    db.run('DELETE FROM port_mappings WHERE id = ?', [mappingId]);
    // 释放占用的端口资源
    if (mapping?.remote_port) {
      portAllocatorService.release(mapping.remote_port);
    }
  }

  /** 删除指定客户端的所有映射 */
  deleteMappingsByClientId(clientId: string): number {
    const db = getDb();
    db.run('DELETE FROM port_mappings WHERE client_id = ?', [clientId]);
    return db.getRowsModified();
  }

  /** 将数据库行转换为 API 响应格式 */
  toApi(mapping: PortMappingRow): Record<string, unknown> {
    return {
      id: mapping.id,
      clientId: mapping.client_id,
      name: mapping.name,
      proxyType: mapping.proxy_type,
      localIp: mapping.local_ip,
      localPort: mapping.local_port,
      remotePort: mapping.remote_port,
      customDomain: mapping.custom_domain,
      status: mapping.status,
      publicUrl: mapping.public_url,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    };
  }
}

/**
 * 获取 FRP 连接信息（下发给客户端）
 * 客户端需要这些信息来连接 frps 并建立控制隧道。
 */
export function getFrpsConnectionInfo() {
  return {
    serverAddr: resolveFrpsHost(),
    serverPort: env.FRPS_PORT,
    authToken: env.FRPS_TOKEN,
  };
}

/** 全局 FRP 服务单例 */
export const frpService = new FrpService();
