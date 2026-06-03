import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ClientBusinessMapping {
  id: string;
  kind: 'business';
  name: string;
  type: 'tcp' | 'http' | 'https';
  localHost: string;
  localPort: number;
  remotePort?: number;
  customDomain?: string;
  publicUrl?: string;
}

function getStorePath(workDir: string): string {
  return path.join(workDir, 'frp-mappings.json');
}

export function loadMappings(workDir: string): ClientBusinessMapping[] {
  const p = getStorePath(workDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveMappings(workDir: string, mappings: ClientBusinessMapping[]): void {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(getStorePath(workDir), JSON.stringify(mappings, null, 2));
}

export function addMapping(workDir: string, mapping: ClientBusinessMapping): void {
  const mappings = loadMappings(workDir);
  mappings.push(mapping);
  saveMappings(workDir, mappings);
}

export function removeMapping(workDir: string, mappingId: string): void {
  const mappings = loadMappings(workDir).filter((m) => m.id !== mappingId);
  saveMappings(workDir, mappings);
}
