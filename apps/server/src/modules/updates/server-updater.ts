export interface ServerUpdater {
  run(input: { campaignId: string; version: string; artifactPath: string }): Promise<void>;
}

export function createNoopServerUpdater(): ServerUpdater {
  return {
    async run() {
      // Placeholder: will be implemented with real filesystem operations
    },
  };
}
