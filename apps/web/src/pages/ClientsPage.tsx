import { useEffect, useState } from 'react';
import { Table, Button, Typography, Tag, Space } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import type { Api } from '../api/http';
import { type ClientSummary, listClients } from '../api/clients';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

interface ClientsPageProps {
  api: Api;
  onViewDetail: (clientId: string) => void;
  onOpenFiles: (clientId: string) => void;
  onOpenMappings: (clientId: string) => void;
  onOpenTasks?: (clientId: string, clientName: string) => void;
}

export function ClientsPage({ api, onViewDetail, onOpenFiles, onOpenMappings, onOpenTasks }: ClientsPageProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listClients(api).then((list) => {
      if (!cancelled) { setClients(list); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>客户端 ({clients.length})</Title>
      <Button onClick={() => { setLoading(true); listClients(api).then(setClients).finally(() => setLoading(false)); }} style={{ marginBottom: 12 }}>
        刷新
      </Button>
      <Table
        dataSource={clients}
        rowKey="id"
        loading={loading}
        size="small"
        columns={[
          { title: 'ID', dataIndex: 'id', key: 'id', width: 150, render: (v: string) => <Text code>{v}</Text> },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (v?: string) => v ? <Text code>v{v}</Text> : '-' },
          { title: '在线', dataIndex: 'online', key: 'online', width: 90, render: (v: boolean) => <StatusTag status={v ? 'online' : 'offline'} /> },
          { title: 'HTTP 就绪', dataIndex: 'httpReady', key: 'httpReady', width: 110, render: (v: boolean) => <StatusTag status={v ? 'active' : 'inactive'} /> },
          {
            title: 'HTTP 地址', dataIndex: 'clientHttpBaseUrl', key: 'http', width: 220,
            render: (v?: string) => v ? <Text code copyable>{v}</Text> : '-',
          },
          {
            title: '能力', dataIndex: 'capabilities', key: 'cap', width: 200,
            render: (cap?: Record<string, boolean>) =>
              cap ? <Space size={4}>{Object.entries(cap).filter(([, v]) => v).map(([k]) => <Tag key={k} style={{ fontSize: 10 }}>{k}</Tag>)}</Space> : '-',
          },
          {
            title: '操作', key: 'actions', width: 250,
            render: (_: unknown, record: ClientSummary) => (
              <Space size={4}>
                <Button size="small" icon={<EyeOutlined />} onClick={() => onViewDetail(record.id)}>详情</Button>
                <Button size="small" onClick={() => onOpenFiles(record.id)}>文件</Button>
                <Button size="small" onClick={() => onOpenMappings(record.id)}>映射</Button>
                <Button size="small" onClick={() => onOpenTasks?.(record.id, record.name)}>任务</Button>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
