import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Modal, Input, InputNumber, Select, Form, Typography, message, Tag, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { Api } from '../api/http';
import { listClientMappings, createClientMapping, deleteClientMapping } from '../api/adminClientHttp';
import { type ClientSummary, listClients } from '../api/clients';

const { Title, Text } = Typography;

type MappingKind = 'all' | 'system' | 'business';

interface MappingsPageProps {
  api: Api;
  clientId?: string;
  clientName?: string;
  onBack?: () => void;
}

interface MappingRow {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  kind: 'system' | 'business' | string;
  type: string;
  localHost: string;
  localPort?: number;
  remotePort?: number;
  publicUrl?: string;
  protected?: boolean;
}

function systemMapping(client: ClientSummary): MappingRow | null {
  if (!client.clientHttpRemotePort && !client.clientHttpBaseUrl) return null;
  return {
    id: `${client.id}:http-control`,
    clientId: client.id,
    clientName: client.name,
    name: 'http-control',
    kind: 'system',
    type: 'tcp',
    localHost: '127.0.0.1',
    remotePort: client.clientHttpRemotePort,
    publicUrl: client.clientHttpBaseUrl,
    protected: true,
  };
}

export function MappingsPage({ api, clientId, clientName, onBack }: MappingsPageProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState(clientId ?? 'all');
  const [kindFilter, setKindFilter] = useState<MappingKind>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [form] = Form.useForm();

  const filteredMappings = useMemo(() => mappings.filter((mapping) => {
    if (clientFilter !== 'all' && mapping.clientId !== clientFilter) return false;
    if (kindFilter !== 'all' && mapping.kind !== kindFilter) return false;
    if (typeFilter !== 'all' && mapping.type !== typeFilter) return false;
    return true;
  }), [mappings, clientFilter, kindFilter, typeFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const clientList = await listClients(api);
      const targetClients = clientId ? clientList.filter((client) => client.id === clientId) : clientList;
      const rows: MappingRow[] = targetClients.flatMap((client) => {
        const system = systemMapping(client);
        return system ? [system] : [];
      });

      const businessLists = await Promise.all(targetClients
        .filter((client) => client.httpReady)
        .map(async (client) => {
          try {
            const res: any = await listClientMappings(api, client.id);
            const list = res?.data?.mappings ?? res?.mappings ?? [];
            return list
              .filter((mapping: any) => mapping.id !== 'http-control')
              .map((mapping: any) => ({ ...mapping, clientId: client.id, clientName: client.name } as MappingRow));
          } catch {
            return [] as MappingRow[];
          }
        }));

      setClients(clientList);
      setMappings([...rows, ...businessLists.flat()]);
    } catch {
      message.error('加载映射失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => undefined); }, [clientId]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const targetClientId = clientId ?? values.clientId;
      if (!targetClientId) {
        message.error('请选择客户端');
        return;
      }

      await createClientMapping(api, targetClientId, {
        name: values.name,
        type: values.type,
        localHost: values.localHost,
        localPort: values.localPort,
        remotePort: values.remotePort || null,
        customDomain: values.customDomain,
      });

      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('创建失败: ' + (err?.message ?? err));
    }
  };

  const handleDelete = async (mapping: MappingRow) => {
    if (mapping.protected || mapping.kind === 'system') return;

    try {
      await deleteClientMapping(api, mapping.clientId, mapping.id);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error('删除失败: ' + (err?.message ?? err));
    }
  };

  return (
    <div>
      {onBack && <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>返回</Button>}
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>{clientId ? `端口映射 — ${clientName ?? clientId}` : '端口映射'}</Title>

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          value={clientFilter}
          disabled={Boolean(clientId)}
          style={{ minWidth: 220 }}
          options={[{ value: 'all', label: '全部客户端' }, ...clients.map((client) => ({ value: client.id, label: `${client.name} (${client.id})` }))]}
          onChange={setClientFilter}
        />
        <Select
          value={kindFilter}
          style={{ width: 120 }}
          options={[{ value: 'all', label: '全部类型' }, { value: 'system', label: '系统' }, { value: 'business', label: '业务' }]}
          onChange={setKindFilter}
        />
        <Select
          value={typeFilter}
          style={{ width: 120 }}
          options={[{ value: 'all', label: '全部协议' }, { value: 'tcp', label: 'tcp' }, { value: 'http', label: 'http' }, { value: 'https', label: 'https' }]}
          onChange={setTypeFilter}
        />
        <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateOpen(true)}>
          创建映射
        </Button>
        <Button onClick={load}>刷新</Button>
      </Space>

      <Table
        dataSource={filteredMappings}
        rowKey={(row) => `${row.clientId}:${row.id}`}
        loading={loading}
        size="small"
        columns={[
          { title: '客户端', key: 'client', width: 180, render: (_: unknown, row: MappingRow) => <Text code>{row.clientName || row.clientId}</Text> },
          { title: '名称', dataIndex: 'name', key: 'name' },
          { title: '类型', dataIndex: 'kind', key: 'kind', width: 80, render: (value: string) => <Tag color={value === 'system' ? 'blue' : 'default'}>{value}</Tag> },
          { title: '协议', dataIndex: 'type', key: 'type', width: 70 },
          { title: '本地', key: 'local', render: (_: unknown, row: MappingRow) => row.localPort ? <Text code>{row.localHost}:{row.localPort}</Text> : '-' },
          { title: '远程端口', dataIndex: 'remotePort', key: 'remotePort', width: 100 },
          { title: '公开地址', dataIndex: 'publicUrl', key: 'publicUrl', width: 220, render: (value?: string) => value ? <Text code copyable>{value}</Text> : '-' },
          {
            title: '操作', key: 'actions', width: 90,
            render: (_: unknown, row: MappingRow) => row.protected || row.kind === 'system'
              ? <Tag color="blue">只读</Tag>
              : <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)} />,
          },
        ]}
      />

      <Modal title="创建映射" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" initialValues={{ localHost: '127.0.0.1', type: 'tcp', clientId: clientFilter === 'all' ? undefined : clientFilter }}>
          {!clientId && (
            <Form.Item name="clientId" label="客户端" rules={[{ required: true, message: '请选择客户端' }]}> 
              <Select options={clients.map((client) => ({ value: client.id, label: `${client.name} (${client.id})` }))} />
            </Form.Item>
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, min: 1 }]}> 
            <Input placeholder="如 vite-dev-server" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}> 
            <Select options={[{ value: 'tcp', label: 'tcp' }, { value: 'http', label: 'http' }, { value: 'https', label: 'https' }]} />
          </Form.Item>
          <Form.Item name="localHost" label="本地地址">
            <Input />
          </Form.Item>
          <Form.Item name="localPort" label="本地端口" rules={[{ required: true, type: 'number', min: 1, max: 65535 }]}> 
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Form.Item>
          <Form.Item name="remotePort" label="远程端口（留空自动分配）">
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
