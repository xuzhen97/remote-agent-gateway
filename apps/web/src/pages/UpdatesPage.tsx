import { useEffect, useMemo, useState } from 'react';
import {
  Typography, Tabs, Card, Button, Modal, Input, Table,
  Space, Tag, Popconfirm, message, Empty, Descriptions, InputNumber,
} from 'antd';
import {
  CloudUploadOutlined, RocketOutlined, ReloadOutlined, PlusOutlined,
} from '@ant-design/icons';
import type { Api } from '../api/http';
import {
  listReleases, registerRelease, getRelease, createCampaign, getCampaign,
  listTargets, retryCampaign,
  type ReleaseSummary, type ReleaseDetail, type CampaignRecord, type TargetRecord,
} from '../api/updates';
import { StatusTag } from '../components/StatusTag';

const { Title, Text } = Typography;

interface UpdatesPageProps { api: Api; }

export function UpdatesPage({ api }: UpdatesPageProps) {
  return (
    <div>
      <Title level={3} style={{ color: 'rgba(255,255,255,0.85)' }}>更新管理</Title>
      <Tabs
        defaultActiveKey="releases"
        items={[
          { key: 'releases', label: <span><CloudUploadOutlined /> 版本发布</span>, children: <ReleasesTab api={api} /> },
          { key: 'campaigns', label: <span><RocketOutlined /> 更新编排</span>, children: <CampaignsTab api={api} /> },
        ]}
      />
    </div>
  );
}

// ==================== Releases Tab ====================

function ReleasesTab({ api }: { api: Api }) {
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [regOpen, setRegOpen] = useState(false);
  const [manifestText, setManifestText] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ReleaseDetail | null>(null);

  const load = async () => {
    setLoading(true);
    try { setReleases(await listReleases(api)); } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, [api]);

  const handleRegister = async () => {
    try {
      await registerRelease(api, manifestText);
      message.success('版本注册成功');
      setRegOpen(false);
      setManifestText('');
      load();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '注册失败');
    }
  };

  const handleViewDetail = async (version: string) => {
    try {
      setDetail(await getRelease(api, version));
      setDetailOpen(true);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '获取详情失败');
    }
  };

  return (
    <Card
      title="已发布版本"
      extra={<Button icon={<PlusOutlined />} onClick={() => setRegOpen(true)}>注册新版本</Button>}
      styles={{ header: { color: 'rgba(255,255,255,0.85)' } }}
    >
      <Table
        dataSource={releases}
        rowKey="version"
        loading={loading}
        size="small"
        pagination={false}
        columns={[
          { title: '版本', dataIndex: 'version', key: 'version', render: (v: string) => <Text code>{v}</Text> },
          {
            title: '状态', dataIndex: 'enabled', key: 'enabled', width: 100,
            render: (v: boolean) => v ? <Tag color="green">已启用</Tag> : <Tag color="default">已禁用</Tag>,
          },
          {
            title: '操作', key: 'actions', width: 120,
            render: (_: unknown, record: ReleaseSummary) => (
              <Button type="link" size="small" onClick={() => handleViewDetail(record.version)}>查看详情</Button>
            ),
          },
        ]}
        locale={{ emptyText: <Empty description="暂无版本发布，点击右上角注册" /> }}
      />

      <Modal
        title="注册新版本"
        open={regOpen}
        onCancel={() => setRegOpen(false)}
        onOk={handleRegister}
        okText="注册"
        width={640}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          粘贴 Release Manifest JSON（version + artifacts 数组）
        </Text>
        <Input.TextArea
          rows={12}
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
          placeholder={`{
  "version": "v1.4.0",
  "artifacts": [
    { "fileName": "server.tar.gz", "targetType": "server", "platform": "linux", "arch": "x64", "sha256": "...", "size": 1024, "enabled": true }
  ]
}`}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      <Modal
        title={detail ? `版本详情: ${detail.version}` : '加载中...'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
      >
        {detail && (
          <Table
            dataSource={detail.artifacts}
            rowKey="fileName"
            size="small"
            pagination={false}
            columns={[
              { title: '文件名', dataIndex: 'fileName', key: 'fileName', render: (v: string) => <Text code>{v}</Text> },
              { title: '目标', key: 'target', render: (_: unknown, r: ReleaseDetail['artifacts'][0]) => `${r.targetType}/${r.platform}/${r.arch}` },
              { title: 'SHA256', dataIndex: 'sha256', key: 'sha256', render: (v: string) => <Text code style={{ fontSize: 10 }}>{v}</Text> },
              { title: '大小', dataIndex: 'size', key: 'size', render: (v: number) => `${(v / 1024).toFixed(1)} KB` },
              { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80, render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag> },
            ]}
          />
        )}
      </Modal>
    </Card>
  );
}

// ==================== Campaigns Tab ====================

function CampaignsTab({ api }: { api: Api }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [targetVersion, setTargetVersion] = useState('');
  const [includeServer, setIncludeServer] = useState(false);
  const [batchSize, setBatchSize] = useState(10);
  const [concurrency, setConcurrency] = useState(5);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [releasesForSelect, setReleasesForSelect] = useState<ReleaseSummary[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(null);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  const loadReleases = async () => {
    try { setReleasesForSelect(await listReleases(api)); } catch { /* ignore */ }
  };
  useEffect(() => { loadReleases(); }, [api]);

  const handleCreate = async () => {
    try {
      const result = await createCampaign(api, {
        targetVersion,
        includeServer,
        batchSize,
        maxConcurrency: concurrency,
        scope: { all: true },
        createdBy: 'web-ui',
      });
      message.success(`编排创建成功: ${result.campaignId.slice(0, 8)}... (${result.targets.length} 个对象)`);
      setCreateOpen(false);
      setCampaignLoading(true);
      try {
        const c = await getCampaign(api, result.campaignId);
        setSelectedCampaign(c);
        setTargets(await listTargets(api, result.campaignId));
      } catch { /* ignore */ }
      setCampaignLoading(false);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleSelectCampaign = async (id: string) => {
    setCampaignLoading(true);
    try {
      setSelectedCampaign(await getCampaign(api, id));
      setTargets(await listTargets(api, id));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '查询失败');
    }
    setCampaignLoading(false);
  };

  const handleRetry = async (campaignId: string, mode: 'failed' | 'offline_skipped' | 'all') => {
    try {
      const res = await retryCampaign(api, campaignId, mode);
      message.success(`已重试 ${res.retried} 个对象`);
      setTargets(await listTargets(api, campaignId));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '重试失败');
    }
  };

  const phaseColor = (phase: string) => {
    if (phase === 'succeeded' || phase === 'verifying') return 'green';
    if (phase === 'failed' || phase === 'rolled_back') return 'red';
    if (phase === 'queued' || phase === 'downloading') return 'blue';
    if (phase === 'offline_skipped') return 'orange';
    return 'default';
  };

  return (
    <Card
      title="更新编排"
      extra={<Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建编排</Button>}
      styles={{ header: { color: 'rgba(255,255,255,0.85)' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card size="small" title="查询已有编排">
          <Space>
            <Input.Search
              placeholder="输入 Campaign ID"
              enterButton="查询"
              onSearch={handleSelectCampaign}
              style={{ width: 360 }}
              loading={campaignLoading}
            />
          </Space>
        </Card>

        {selectedCampaign && (
          <>
            <Card size="small" title={`编排 ${selectedCampaign.id.slice(0, 12)}...`}>
              <Descriptions column={4} size="small">
                <Descriptions.Item label="目标版本"><Text code>{selectedCampaign.targetVersion}</Text></Descriptions.Item>
                <Descriptions.Item label="状态"><Tag>{selectedCampaign.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="包含 Server">{selectedCampaign.includeServer ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="批次大小">{selectedCampaign.batchSize}</Descriptions.Item>
                <Descriptions.Item label="并发数">{selectedCampaign.maxConcurrency}</Descriptions.Item>
                <Descriptions.Item label="创建者">{selectedCampaign.createdBy}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(selectedCampaign.createdAt).toLocaleString()}</Descriptions.Item>
              </Descriptions>
              <Space style={{ marginTop: 12 }}>
                <Popconfirm title="确定重试所有失败项?" onConfirm={() => handleRetry(selectedCampaign.id, 'failed')}>
                  <Button size="small" icon={<ReloadOutlined />}>重试失败</Button>
                </Popconfirm>
                <Popconfirm title="确定重试离线跳过项?" onConfirm={() => handleRetry(selectedCampaign.id, 'offline_skipped')}>
                  <Button size="small" icon={<ReloadOutlined />}>重试离线</Button>
                </Popconfirm>
                <Button size="small" onClick={() => { setTargetsLoading(true); listTargets(api, selectedCampaign.id).then(setTargets).finally(() => setTargetsLoading(false)); }}>刷新状态</Button>
              </Space>
            </Card>

            <Card size="small" title={`更新对象 (${targets.length})`}>
              <Table
                dataSource={targets}
                rowKey="id"
                size="small"
                loading={targetsLoading}
                pagination={false}
                columns={[
                  { title: '类型', dataIndex: 'targetType', key: 'targetType', width: 80, render: (v: string) => v === 'server' ? <Tag color="purple">Server</Tag> : <Tag color="cyan">Client</Tag> },
                  { title: '客户端', dataIndex: 'clientId', key: 'clientId', render: (v: string | null) => v ? <Text code>{v.slice(0, 12)}</Text> : '-' },
                  { title: '平台', dataIndex: 'platform', key: 'platform', width: 80 },
                  { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, render: (v: string) => <Tag color={phaseColor(v)}>{v}</Tag> },
                  { title: '尝试', dataIndex: 'attemptCount', key: 'attemptCount', width: 60 },
                ]}
                locale={{ emptyText: <Empty description="暂无更新对象" /> }}
              />
            </Card>
          </>
        )}
      </Space>

      <Modal
        title="新建更新编排"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="创建"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>目标版本</Text>
          <Input
            placeholder="v1.4.0"
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            list="release-versions"
          />
          <datalist id="release-versions">
            {releasesForSelect.map((r) => <option key={r.version} value={r.version} />)}
          </datalist>

          <Space>
            <Button
              type={includeServer ? 'primary' : 'default'}
              onClick={() => setIncludeServer(!includeServer)}
            >{includeServer ? '✓ 更新 Server' : '更新 Server'}</Button>
          </Space>

          <Space>
            <Text>批次大小</Text>
            <InputNumber min={1} max={100} value={batchSize} onChange={(v) => setBatchSize(v ?? 10)} />
            <Text>并发数</Text>
            <InputNumber min={1} max={50} value={concurrency} onChange={(v) => setConcurrency(v ?? 5)} />
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}
