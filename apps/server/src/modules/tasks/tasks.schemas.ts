import { TaskHistoryQuerySchema } from '@rag/shared';

export function parseTaskHistoryQuery(input: unknown) {
  return TaskHistoryQuerySchema.parse(input);
}
