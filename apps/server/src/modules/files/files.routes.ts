import type { FastifyInstance } from 'fastify';
import { filesService } from './files.service.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { auditService } from '../audit/audit.service.js';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Upload file
  app.post('/api/files', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const buffer = await data.toBuffer();
    const file = await filesService.storeFile(data.filename, buffer, data.mimetype);

    auditService.log({
      actor: (request as unknown as { authRole: string }).authRole,
      action: 'file.upload',
      targetType: 'file',
      targetId: file.id,
      detail: `Uploaded ${file.original_name} (${file.size} bytes)`,
    });

    return reply.code(201).send(filesService.toApi(file));
  });

  // List files
  app.get('/api/files', async (_request, reply) => {
    const fileList = filesService.listFiles();
    return reply.send(fileList.map((f) => filesService.toApi(f)));
  });

  // Download file
  app.get<{ Params: { fileId: string } }>('/api/files/:fileId/download', async (request, reply) => {
    const file = filesService.getFile(request.params.fileId);
    if (!file) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const content = filesService.readFileContent(request.params.fileId);
    if (!content) {
      return reply.code(404).send({ error: 'File content not found on disk' });
    }

    reply.header('Content-Type', file.mime_type ?? 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${file.original_name}"`);
    reply.header('Content-Length', content.length);
    return reply.send(content);
  });
}
