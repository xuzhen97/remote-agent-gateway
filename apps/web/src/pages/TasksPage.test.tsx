import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TasksPage } from './TasksPage.js';

describe('TasksPage', () => {
  it('renders the page title', async () => {
    const api = { get: vi.fn()
      .mockResolvedValueOnce([]) // listClients result
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }) // listTasks result
    } as any;

    render(<TasksPage api={api} />);
    expect(await screen.findByText('任务')).toBeInTheDocument();
  });

  it('renders task fields and opens detail with recordId', async () => {
    const api = {
      get: vi.fn()
        .mockResolvedValueOnce([{ id: 'dev-client-01', name: 'Development Machine' }])
        .mockResolvedValueOnce({
          items: [{
            recordId: 'rec_02',
            clientId: 'dev-client-01',
            clientNameSnapshot: 'Development Machine (dev-client-01)',
            requestId: 'req_02',
            resourceType: 'job',
            actionType: 'job.command',
            method: 'POST',
            path: '/jobs/command',
            targetId: 'ipconfig',
            sourceType: 'agent-api',
            actorType: 'agent-token',
            actorLabel: 'agent-api/agent-token',
            querySummary: { clientId: 'dev-client-01' },
            requestSummary: { command: 'ipconfig' },
            resultSummary: { exitCode: 0, stdoutBytes: 1234 },
            status: 'success',
            httpStatus: 200,
            startedAt: 1710000000000,
            finishedAt: 1710000002500,
            durationMs: 2500,
            reportedAt: 1710000002501,
          }],
          total: 1,
          page: 1,
          pageSize: 20,
        })
        .mockResolvedValueOnce({
          recordId: 'rec_02',
          requestSummary: { command: 'ipconfig' },
          resultSummary: { exitCode: 0, stdoutBytes: 1234 },
          errorMessage: null,
        }),
    } as any;

    render(<TasksPage api={api} />);

    expect(await screen.findByText('Development Machine (dev-client-01)')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    expect(screen.getByText('{"exitCode":0,"stdoutBytes":1234}')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(await screen.findByText('任务详情')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/api/tasks/rec_02');
    expect(screen.getAllByText('rec_02').length).toBeGreaterThan(0);
  });
});
