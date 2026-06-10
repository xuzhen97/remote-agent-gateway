#!/usr/bin/env node
/**
 * sync-version.ts — 将根 package.json 的版本同步到所有子包。
 *
 * 用法:
 *   tsx scripts/sync-version.ts          # 同步根版本到所有子包
 *   tsx scripts/sync-version.ts --bump patch  # bump 根版本 + 同步 + git tag
 *   tsx scripts/sync-version.ts --bump minor
 *   tsx scripts/sync-version.ts --bump major
 *
 * 也支持通过根 package.json scripts 调用:
 *   pnpm version:sync
 *   pnpm version:patch
 *   pnpm version:minor
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** 所有需要同步版本的子包 */
const SUB_PACKAGES = [
  'apps/server/package.json',
  'apps/client/package.json',
  'apps/web/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
];

interface PkgJson {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

function readJson(path: string): PkgJson {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path: string, data: PkgJson): void {
  // Preserve trailing newline
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function isGitClean(): boolean {
  try {
    const out = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' });
    return out.trim() === '';
  } catch {
    return false;
  }
}

function gitAdd(pattern: string): void {
  execSync(`git add ${pattern}`, { cwd: root, stdio: 'ignore' });
}

/** 同步根版本到所有子包，不做 git 操作（由调用方处理） */
function syncAll(rootVersion: string): string[] {
  const updated: string[] = [];
  for (const rel of SUB_PACKAGES) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) {
      console.warn(`  ⚠ 跳过(不存在): ${rel}`);
      continue;
    }
    const pkg = readJson(abs);
    if (pkg.version === rootVersion) {
      console.log(`  ✓ 已同步: ${rel} (${rootVersion})`);
      continue;
    }
    pkg.version = rootVersion;
    writeJson(abs, pkg);
    updated.push(rel);
    console.log(`  → 更新: ${rel}: ${rootVersion}`);
  }
  return updated;
}

// ==================== main ====================
const args = process.argv.slice(2);
const bumpType = args.includes('--bump') ? (args[args.indexOf('--bump') + 1] ?? 'patch') : null;

if (bumpType) {
  const valid = ['patch', 'minor', 'major'];
  if (!valid.includes(bumpType)) {
    console.error(`无效 bump 类型: "${bumpType}"，可选: ${valid.join(', ')}`);
    process.exit(1);
  }

  // 1) Bump 根版本
  console.log(`\n📦 Bump 根版本: ${bumpType}`);
  execSync(`npm version ${bumpType} --no-git-tag-version`, { cwd: root, stdio: 'inherit' });

  // 2) 读取新版本号
  const rootPkg = readJson(resolve(root, 'package.json'));
  const newVersion = rootPkg.version!;
  console.log(`   根版本 → ${newVersion}\n`);

  // 3) 同步到子包
  console.log('🔄 同步子包版本...');
  const updated = syncAll(newVersion);

  // 4) Git 提交 + 标签
  console.log('');
  const files = ['package.json', ...updated];
  for (const f of files) gitAdd(f);
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { cwd: root, stdio: 'inherit' });
  execSync(`git tag v${newVersion}`, { cwd: root, stdio: 'inherit' });

  console.log(`\n✅ 完成! 版本 ${newVersion}, tag v${newVersion}`);
} else {
  // 纯同步模式
  const rootPkg = readJson(resolve(root, 'package.json'));
  const rootVersion = rootPkg.version!;
  console.log(`\n🔄 同步版本 ${rootVersion} 到子包...\n`);
  const updated = syncAll(rootVersion);

  if (updated.length > 0) {
    for (const f of updated) gitAdd(f);
    console.log(`\n✅ ${updated.length} 个子包已同步到 ${rootVersion}`);
  } else {
    console.log('\n✅ 所有子包版本一致');
  }
}
