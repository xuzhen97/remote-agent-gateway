import { readBuildVersion } from '@rag/shared';

export const SERVER_VERSION = readBuildVersion(process.env.RAG_BUILD_VERSION);
