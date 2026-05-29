import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ClientConfigSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  serverUrl: z.string().url(),
  apiBaseUrl: z.string().url(),
  token: z.string().min(1),
  workspaceDir: z.string().min(1),
  frpcPath: z.string().optional(),
  frpcWorkDir: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export function loadConfig(configPath = './config.json'): ClientConfig {
  if (!fs.existsSync(configPath)) {
    // Auto-create from example if available
    const examplePath = path.join(path.dirname(configPath), 'config.example.json');
    if (fs.existsSync(examplePath)) {
      console.log(`Config file not found, copying from ${examplePath}`);
      fs.copyFileSync(examplePath, configPath);
    } else {
      throw new Error(
        `Config file not found: ${configPath}\n` +
        `Create it manually or copy from config.example.json.`
      );
    }
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return ClientConfigSchema.parse(raw);
}
