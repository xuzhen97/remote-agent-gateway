import { useEffect, useState } from 'react';
import { Table, Button, Modal, Input, Select, Form, Typography, message, Tag, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { Api } from '../api/http';
import { listClientMappings, createClientMapping, deleteClientMapping } from '../api/adminClientHttp';

const { Title, Text } = Typography;

interface MappingsPageProps {
  api: Api;
  clientId: string;
  clientName: string;
  onBack: () => void;
}

interface MappingRow {
  id: string;
  name: string;
  kind: string;
  type: string;
  localHost: string;
  localPort: number;
  remotePort?: number;
  publicUrl?: string;
  protected?: boolean;
}

export function MappingsPage({ api, clientId, clientName, onBack }: MappingsPageProps) {
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await listClientMappings(api, clientId);
      setMappings(res?.data?.mappings ?? res?.mappings ?? []);
    } catch {
      message.error('加载映射失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => {}); }, [clientId]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await createClientMapping(api, clientId, values);
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('创建失败: ' + (err?.message ?? err));
    }
  };

  const handleDelete = async (mappingId: string) => {
    try {
      await deleteClientMapping(api, clientId, mappingId);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error('删除失败: ' + (err?.message ?? err));
    }
  };

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>返回</Button>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>端口映射 — {clientName}</Title>

      <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)} style={{ marginBottom: 12 }}>
        创建映射
      </Button>

      <Table
        dataSource={mappings}
        rowKey="id"
        loading={loading}
        size="small"
        columns={[
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '类型', dataIndex: 'kind', key: 'kind', width: 80, render: (v: string) => <Tag color={v === 'system' ? 'blue' : 'default'}>{v}</Tag> },
          { title: '协议', dataIndex: 'type', key: 'type', width: 60 },
          { title: '本地', key: 'local', render: (_: unknown, r: MappingRow) => <Text code>{r.localHost}:{r.localPort}</Text> },
          { title: '远程端口', dataIndex: 'remotePort', key: 'remotePort', width: 100 },
          { title: '公开地址', dataIndex: 'publicUrl', key: 'publicUrl', width: 200, render: (v?: string) => v ? <Text code copyable>{v}</Text> : '-' },
          {
            title: '操作', key: 'actions', width: 80,
            render: (_: unknown, r: MappingRow) => r.protected ? <Tag color="blue">系统</Tag> : (
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
            ),
          },
        ]}
      />

      <Modal title="创建映射" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, min: 1 }]}>
            <Input placeholder="如 vite-dev-server" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'tcp', label: 'tcp' }, { value: 'http', label: 'http' }, { value: 'https', label: 'https' }]} />
          </Form.Item>
          <Form.Item name="localHost" label="本地地址" initialValue="127.0.0.1">
            <Input />
          </Form.Item>
          <Form.Item name="localPort" label="本地端口" rules={[{ required: true, type: 'number', min: 1, max: 65535 }]}>
            <Input type="number" />
          </Form.Item>
          <Form.Item name="remotePort" label="远程端口（留空自动分配）">
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
