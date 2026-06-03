import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
