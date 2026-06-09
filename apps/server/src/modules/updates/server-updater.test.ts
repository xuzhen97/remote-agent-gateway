import { describe, it, expect } from 'vitest';
import { createNoopServerUpdater } from './server-updater.js';

describe('server updater', () => {
  it('provides a noop updater contract that completes', async () => {
    const updater = createNoopServerUpdater();
    await updater.run({ campaignId: 'camp_1', version: 'v1.4.0', artifactPath: '/tmp/pkg.tar.gz' });
    // should not throw
  });
});
