import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';

export interface ReleaseServiceForRoutes {
  listReleases(): Array<{ version: string }>;
  getRelease(version: string): unknown;
  getArtifactDownload(version: string, artifactName: string): { path: string };
}

export async function releaseRoutes(app: FastifyInstance, opts: { service: ReleaseServiceForRoutes }): Promise<void> {
  const { service } = opts;

  app.get('/admin/updates/releases', async () => ({
    ok: true,
    data: service.listReleases(),
  }));

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
