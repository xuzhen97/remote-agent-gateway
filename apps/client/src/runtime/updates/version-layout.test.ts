import { describe, expect, it } from 'vitest';
import { resolveVersionLayout } from './version-layout.js';

describe('version layout', () => {
  it('builds platform-safe version and download paths', () => {
    const layout = resolveVersionLayout('/opt/rag-client', 'v1.4.0');
    expect(layout.versionsDir).toMatch(/versions$/);
    expect(layout.versionDir).toMatch(/versions[/\\]v1\.4\.0$/);
    expect(layout.downloadsDir).toMatch(/downloads$/);
    expect(layout.stateDir).toMatch(/state$/);
    expect(layout.currentVersionFile).toMatch(/current-version\.json$/);
  });
});
