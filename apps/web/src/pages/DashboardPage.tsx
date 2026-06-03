import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Spin, Typography } from 'antd';
import {
  CloudServerOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import type { Api } from '../api/http';
import { type ClientSummary, listClients } from '../api/clients';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

interface DashboardPageProps {
  api: Api;
}

export function DashboardPage({ api }: DashboardPageProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listClients(api).then((list) => {
      if (!cancelled) { setClients(list); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  const onlineCount = clients.filter((c) => c.online).length;
  const httpReadyCount = clients.filter((c) => c.httpReady).length;
  const notReadyCount = clients.filter((c) => c.online && !c.httpReady).length;

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>仪表盘</Title>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>在线客户端</Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#3fb950' }}>
              <CloudServerOutlined /> {onlineCount}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>共 {clients.length} 台</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>HTTP 就绪</Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#58a6ff' }}>
              <CheckCircleOutlined /> {httpReadyCount}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>HTTP 未就绪</Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#d2991d' }}>
              <ExclamationCircleOutlined /> {notReadyCount}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>离线</Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#6e7681' }}>
              <ApiOutlined /> {clients.length - onlineCount}
            </div>
          </Card>
        </Col>
      </Row>
      <Title level={5} style={{ color: 'rgba(255,255,255,0.85)' }}>最近客户端</Title>
      <Table
        dataSource={clients}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', key: 'id', width: 160, render: (v: string) => <Text code>{v.slice(0, 12)}</Text> },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '在线', dataIndex: 'online', key: 'online', width: 100, render: (v: boolean) => <StatusTag status={v ? 'online' : 'offline'} /> },
          { title: 'HTTP 就绪', dataIndex: 'httpReady', key: 'httpReady', width: 120, render: (v: boolean) => <StatusTag status={v ? 'active' : 'inactive'} /> },
        ]}
      />
    </div>
  );
}
