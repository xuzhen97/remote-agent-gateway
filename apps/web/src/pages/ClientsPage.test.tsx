import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { ClientsPage } from './ClientsPage.js';

describe('ClientsPage', () => {
  const noop = vi.fn();

  it('renders a dedicated version column when the client version is available', async () => {
    const api = {
      get: vi.fn().mockResolvedValue([
        {
          id: 'client-1',
          name: 'Client 1',
          version: '0.1.0',
          online: true,
          status: 'online',
          httpReady: true,
          clientHttpBaseUrl: 'http://127.0.0.1:20004',
          capabilities: { jobs: true },
        },
      ]),
    } as any;

    render(
      <App>
        <ClientsPage
          api={api}
          onViewDetail={noop}
          onOpenFiles={noop}
          onOpenMappings={noop}
          onOpenTasks={noop}
        />
      </App>,
    );

    expect(await screen.findByText('版本')).toBeInTheDocument();
    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
  });

  it('renders a dash when the client version is missing', async () => {
    const api = {
      get: vi.fn().mockResolvedValue([
        {
          id: 'client-2',
          name: 'Client 2',
          online: true,
          status: 'online',
          httpReady: true,
          clientHttpBaseUrl: 'http://127.0.0.1:20005',
          capabilities: { files: true },
        },
      ]),
    } as any;

    render(
      <App>
        <ClientsPage
          api={api}
          onViewDetail={noop}
          onOpenFiles={noop}
          onOpenMappings={noop}
          onOpenTasks={noop}
        />
      </App>,
    );

    const nameCell = await screen.findByText('Client 2');
    const row = nameCell.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('-')).toBeInTheDocument();
  });
});
