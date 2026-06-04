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

  it('supports row selection and bulk deletion of task records', async () => {
    const api = {
      get: vi.fn()
        .mockResolvedValueOnce([{ id: 'dev-client-01', name: 'Development Machine' }])
        .mockResolvedValueOnce({
          items: [
            { recordId: 'rec_a', clientId: 'dev-client-01', actorLabel: 'actor', actionType: 'job.command', targetId: 'job_a', status: 'success', durationMs: 10, resultSummary: { status: 'running' }, startedAt: 1, finishedAt: 2 },
            { recordId: 'rec_b', clientId: 'dev-client-01', actorLabel: 'actor', actionType: 'job.command', targetId: 'job_b', status: 'success', durationMs: 10, resultSummary: { status: 'running' }, startedAt: 1, finishedAt: 2 },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        })
        .mockResolvedValueOnce([{ id: 'dev-client-01', name: 'Development Machine' }])
        .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }),
      post: vi.fn(async () => ({ requested: 2, deleted: 2, recordIds: ['rec_a', 'rec_b'] })),
    } as any;

    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<TasksPage api={api} />);

    expect(await screen.findByText('job_a')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }));

    expect(api.post).toHaveBeenCalledWith('/api/tasks/bulk-delete', { recordIds: ['rec_a', 'rec_b'] });
    vi.unstubAllGlobals();
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
            targetId: 'job_aa722749-247',
            sourceType: 'agent-api',
            actorType: 'agent-token',
            actorLabel: 'agent-api/agent-token',
            querySummary: { clientId: 'dev-client-01' },
            requestSummary: { command: 'ipconfig' },
            resultSummary: {
              jobId: 'job_aa722749-247',
              lifecycle: { status: 'success', exitCode: 0, durationMs: 2500 },
              extracted: { ipv4: ['192.168.0.12'] },
              output: { stdoutLineCount: 18, stderrLineCount: 0, stdoutTail: ['IPv4 Address. . . . . . . . . . . : 192.168.0.12'], stderrTail: [] },
            },
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
          clientId: 'dev-client-01',
          requestSummary: { command: 'ipconfig' },
          resultSummary: {
            jobId: 'job_aa722749-247',
            lifecycle: { status: 'success', exitCode: 0, durationMs: 2500, startedAt: 1710000000000, finishedAt: 1710000002500 },
            extracted: { ipv4: ['192.168.0.12'], defaultGateway: ['192.168.0.1'] },
            output: { stdoutLineCount: 18, stderrLineCount: 0, stdoutTail: ['IPv4 Address. . . . . . . . . . . : 192.168.0.12'], stderrTail: [] },
          },
          metadata: { jobRef: { jobId: 'job_aa722749-247' } },
          errorMessage: null,
        })
        .mockResolvedValueOnce({
          data: {
            logs: [
              { seq: 1, stream: 'stdout', content: 'Windows IP Configuration', timestamp: 1710000000010 },
              { seq: 2, stream: 'stdout', content: 'IPv4 Address. . . . . . . . . . . : 192.168.0.12', timestamp: 1710000000020 },
            ],
          },
        })
    } as any;

    render(<TasksPage api={api} />);

    expect(await screen.findByText('Development Machine (dev-client-01)')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    expect(screen.getByText('success · exitCode 0 · IPv4 192.168.0.12 · stdout 18 行')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(await screen.findByText('任务详情')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/tasks/rec_02');
    expect(screen.getAllByText('rec_02').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('192.168.0.12');
    expect(document.body.textContent).toContain('192.168.0.1');

    fireEvent.click(screen.getByRole('button', { name: '加载完整日志' }));
    await screen.findByText('加载完整日志');
    expect(api.get).toHaveBeenCalledWith('/api/clients/dev-client-01/http/jobs/job_aa722749-247/logs');
    expect(document.body.textContent).toContain('Windows IP Configuration');
  });
});
