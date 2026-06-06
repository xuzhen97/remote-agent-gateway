import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLayout } from './AppLayout.js';

describe('AppLayout', () => {
  it('uses viewport-fixed shell and scrollable content pane', () => {
    render(
      <AppLayout current="dashboard" onNavigate={vi.fn()} onLogout={vi.fn()}>
        <div>content</div>
      </AppLayout>,
    );

    const title = screen.getByText('RAG 控制台');
    const sider = title.closest('aside') as HTMLElement;
    expect(sider.style.height).toBe('100vh');

    const content = screen.getByText('content').closest('.ant-layout-content') as HTMLElement;
    expect(content.style.overflow).toBe('auto');
    expect(content.style.height).toBe('100vh');
  });
});
