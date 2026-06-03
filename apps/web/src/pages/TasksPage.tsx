import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Table, Typography } from 'antd';
import type { Api } from '../api/http';
import { getTaskDetail, listTasks } from '../api/tasks';
import { listClients } from '../api/clients';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

export function TasksPage({ api, initialClientId, initialClientName }: {
  api: Api;
  initialClientId?: string;
  initialClientName?: string;
}) {
  const [filters, setFilters] = useState({ clientId: initialClientId ?? 'all', status: 'all', keyword: '' });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    const query = {
      clientId: filters.clientId !== 'all' ? filters.clientId : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      keyword: filters.keyword || undefined,
      page: 1,
      pageSize: 20,
    };
    const [clientList, taskPage] = await Promise.all([
      listClients(api),
      listTasks(api, query),
    ]);
    setClients(clientList.map((client: any) => ({ id: client.id, name: client.name })));
    setRows(taskPage.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [filters.clientId, filters.status, filters.keyword]);

  const title = useMemo(() => (
    initialClientId ? `任务 — ${initialClientName ?? initialClientId}` : '任务'
  ), [initialClientId, initialClientName]);

  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>{title}</Title>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          value={filters.clientId}
          style={{ minWidth: 220 }}
          options={[
            { value: 'all', label: '全部客户端' },
            ...clients.map((client) => ({ value: client.id, label: `${client.name} (${client.id})` })),
          ]}
          onChange={(value) => setFilters((current) => ({ ...current, clientId: value }))}
        />
        <Select
          value={filters.status}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'success', label: 'success' },
            { value: 'failed', label: 'failed' },
            { value: 'cancelled', label: 'cancelled' },
          ]}
          onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索 client / target / action / error"
          onSearch={(value) => setFilters((current) => ({ ...current, keyword: value }))}
          style={{ width: 280 }}
        />
        <Button onClick={() => load()}>刷新</Button>
      </Space>

      <Table
        rowKey="recordId"
        dataSource={rows}
        loading={loading}
        size="small"
        columns={[
          { title: '时间', key: 'time', width: 180, render: (_: unknown, row: any) => new Date(row.finishedAt ?? row.startedAt).toLocaleString() },
          { title: '客户端', key: 'client', width: 200, render: (_: unknown, row: any) => <Text code>{row.clientNameSnapshot ?? row.clientId}</Text> },
          { title: '来源', dataIndex: 'actorLabel', key: 'actorLabel', width: 200 },
          { title: '动作', dataIndex: 'actionType', key: 'actionType', width: 160 },
          { title: '目标', dataIndex: 'targetId', key: 'targetId' },
          { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (value: string) => <StatusTag status={value} /> },
          { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100, render: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms` },
          { title: '结果摘要', key: 'resultSummary', render: (_: unknown, row: any) => JSON.stringify(row.resultSummary ?? {}) },
          {
            title: '操作', key: 'actions', width: 120,
            render: (_: unknown, row: any) => (
              <Button
                size="small"
                onClick={async () => {
                  const value = await getTaskDetail(api, row.recordId);
                  setDetail(value);
                  setDrawerOpen(true);
                }}
              >
                查看详情
              </Button>
            ),
          },
        ]}
      />

      <Drawer title="任务详情" open={drawerOpen} width={720} onClose={() => setDrawerOpen(false)}>
        {detail ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text strong>recordId</Text>
              <pre>{detail.recordId}</pre>
            </div>
            <div>
              <Text strong>requestSummary</Text>
              <pre>{JSON.stringify(detail.requestSummary ?? {}, null, 2)}</pre>
            </div>
            <div>
              <Text strong>resultSummary</Text>
              <pre>{JSON.stringify(detail.resultSummary ?? {}, null, 2)}</pre>
            </div>
            <div>
              <Text strong>error</Text>
              <pre>{detail.errorMessage ?? '-'}</pre>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
