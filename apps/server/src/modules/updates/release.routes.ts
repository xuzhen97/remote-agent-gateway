import type { FastifyInstance } from 'fastify';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';

export interface ReleaseServiceForRoutes {
  listReleases(): Array<{ version: string; enabled?: boolean }>;
  getRelease(version: string): unknown;
  registerRelease(manifestJson: string): { version: string };
  getArtifactDownload(version: string, artifactName: string): { path: string };
  getArtifactDir(version: string): string;
}

export async function releaseRoutes(app: FastifyInstance, opts: { service: ReleaseServiceForRoutes }): Promise<void> {
  const { service } = opts;

  // ==================== 注册 Release ====================
  app.post<{ Body: { manifest: string } }>('/admin/updates/releases', async (request, reply) => {
    try {
      const result = service.registerRelease(request.body.manifest);
      return { ok: true, data: result };
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: { code: 'RELEASE_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  // ==================== 列出所有 Release ====================
  app.get('/admin/updates/releases', async () => ({
    ok: true,
    data: service.listReleases(),
  }));

  // ==================== 上传 Artifact ====================
  app.post<{ Params: { version: string } }>(
    '/admin/updates/releases/:version/artifacts',
    async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) {
          return reply.code(400).send({ ok: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
        }

        const buf = await data.toBuffer();
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const size = buf.length;
        const fileName = data.filename;

        const lower = fileName.toLowerCase();
        const targetType: 'server' | 'client' = lower.includes('server') ? 'server' : 'client';
        const platform: 'windows' | 'linux' = lower.includes('win') ? 'windows' : 'linux';
        const arch = lower.includes('arm64') ? 'arm64' : 'x64';

        const dir = service.getArtifactDir(request.params.version);
        mkdirSync(dir, { recursive: true });
        const dest = join(dir, fileName);
        await pipeline(Readable.from(buf), createWriteStream(dest));

        return { ok: true, data: { fileName, targetType, platform, arch, sha256, size, enabled: true } };
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: { code: 'UPLOAD_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  );

  // ==================== 获取单个 Release ====================
  app.get<{ Params: { version: string } }>('/admin/updates/releases/:version', async (request, reply) => {
    try {
      const release = service.getRelease(request.params.version);
      return { ok: true, data: release };
    } catch (err) {
      return reply.code(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  // ==================== 下载 Artifact ====================
  app.get<{ Params: { version: string; artifactName: string } }>(
    '/updates/artifacts/:version/:artifactName',
    async (request, reply) => {
      try {
        const result = service.getArtifactDownload(request.params.version, request.params.artifactName);
        if (!existsSync(result.path)) {
          return reply.code(404).send({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Artifact not found' },
          });
        }
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(createReadStream(result.path));
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: {
            code: 'ARTIFACT_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );
}
