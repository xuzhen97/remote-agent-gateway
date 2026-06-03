import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';

const statusColor: Record<string, string> = {
  online: 'green',
  offline: 'red',
  success: 'green',
  failed: 'red',
  pending: 'gold',
  running: 'blue',
  dispatched: 'blue',
  active: 'green',
  inactive: 'default',
  error: 'red',
  cancelled: 'default',
};

const statusIcons: Record<string, React.ReactNode> = {
  online: <CheckCircleOutlined />,
  offline: <CloseCircleOutlined />,
  running: <SyncOutlined spin />,
  pending: <SyncOutlined spin />,
};

export function StatusTag({ status }: { status: string }) {
  return (
    <Tag color={statusColor[status] ?? 'default'} icon={statusIcons[status]}>
      {status}
    </Tag>
  );
}
