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
  allowedRoots: z.array(z.string()).optional().default([]),
  frpcPath: z.string().optional(),
  frpcWorkDir: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

function resolveExecutablePath(configDir: string, configuredPath?: string): string | undefined {
  const relativeInput = configuredPath?.replace(/^[.][/\\]/, '') ?? 'bin/frpc';
  const candidates: string[] = [];

  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      candidates.push(configuredPath);
    } else {
      candidates.push(path.resolve(configDir, configuredPath));
    }
  }

  let current = configDir;
  for (;;) {
    candidates.push(path.resolve(current, relativeInput));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
    if (process.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe')) {
      const withExe = `${candidate}.exe`;
      if (fs.existsSync(withExe)) return withExe;
    }
  }

  return configuredPath
    ? (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(configDir, configuredPath))
    : undefined;
}

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
  const parsed = ClientConfigSchema.parse(raw);
  const configDir = path.dirname(path.resolve(configPath));

  return {
    ...parsed,
    frpcPath: resolveExecutablePath(configDir, parsed.frpcPath),
  };
}
