import { readBuildVersion } from '@rag/shared';

export const CLIENT_VERSION = readBuildVersion(process.env.RAG_BUILD_VERSION);
