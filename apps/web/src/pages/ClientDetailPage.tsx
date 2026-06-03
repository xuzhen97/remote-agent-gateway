import { useEffect, useState } from 'react';
import { Descriptions, Button, Spin, Typography, Alert, Card } from 'antd';
import { ArrowLeftOutlined, CopyOutlined } from '@ant-design/icons';
import type { Api } from '../api/http';
import { type ClientDetail, getClient } from '../api/clients';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

interface ClientDetailPageProps {
  api: Api;
  clientId: string;
  onBack: () => void;
}

export function ClientDetailPage({ api, clientId, onBack }: ClientDetailPageProps) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClient(api, clientId).then((c) => {
      if (!cancelled) { setClient(c); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, clientId]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!client) return <Alert type="error" message="无法加载客户端信息" showIcon />;

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>返回</Button>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>{client.name}</Title>

      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="ID"><Text code>{client.id}</Text></Descriptions.Item>
        <Descriptions.Item label="状态"><StatusTag status={client.status} /></Descriptions.Item>
        <Descriptions.Item label="HTTP 就绪">{client.httpReady ? <StatusTag status="active" /> : <StatusTag status="inactive" />}</Descriptions.Item>
        <Descriptions.Item label="远程端口">{client.clientHttpRemotePort ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="HTTP 地址" span={2}>
          {client.clientHttpBaseUrl ? (
            <Text code copyable>{client.clientHttpBaseUrl}</Text>
          ) : '-'}
        </Descriptions.Item>
      </Descriptions>

      {client.clientHttpToken && (
        <Card style={{ marginTop: 16 }} title="HTTP Token">
          <Alert
            type="warning"
            message="此 token 仅供 server 内部使用。调用方通过 server API 获取 token 后直连 client HTTP，不经过 server 代理大流量。"
            showIcon
            style={{ marginBottom: 12 }}
          />
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              setShowToken(!showToken);
              if (client.clientHttpToken && !showToken) {
                navigator.clipboard.writeText(client.clientHttpToken);
              }
            }}
          >
            {showToken ? '隐藏' : '点击显示并复制 Token'}
          </Button>
          {showToken && (
            <div style={{ marginTop: 8 }}>
              <Text code copyable style={{ wordBreak: 'break-all' }}>{client.clientHttpToken}</Text>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
