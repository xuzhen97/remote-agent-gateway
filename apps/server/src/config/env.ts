import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  SERVER_HOST: z.string().default('0.0.0.0'),
  ADMIN_TOKEN: z.string().min(1),
  AGENT_API_TOKEN: z.string().min(1),
  FRP_TOKEN: z.string().default('change_me_frp_token'),
  DB_PATH: z.string().default('./storage/db.sqlite'),
  STORAGE_DIR: z.string().default('./storage/files'),
  FRP_PORT_RANGE_START: z.coerce.number().int().default(20000),
  FRP_PORT_RANGE_END: z.coerce.number().int().default(25000),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
