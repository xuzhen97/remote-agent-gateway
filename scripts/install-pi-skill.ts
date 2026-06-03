import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallPiSkillOptions {
  source?: string;
  target?: string;
}

export interface InstallPiSkillResult {
  source: string;
  target: string;
}

export async function installPiSkill(options: InstallPiSkillOptions = {}): Promise<InstallPiSkillResult> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = options.source ?? join(repoRoot, 'skills', 'rag-agent');
  const target = options.target ?? join(homedir(), '.pi', 'agent', 'skills', 'rag-agent');

  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) throw new Error(`Skill source is not a directory: ${source}`);

  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return { source, target };
}

async function main(): Promise<void> {
  const result = await installPiSkill();
  console.log(`Installed rag-agent skill to ${result.target}`);
  console.log('Restart Pi Agent or reload skills to use /skill:rag-agent.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
