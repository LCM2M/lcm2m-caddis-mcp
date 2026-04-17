import { z } from 'zod';

const ConfigSchema = z.object({
  apiUrl: z
    .string()
    .url()
    .default('https://api.lcm2m.com')
    .transform((url) => url.replace(/\/+$/, '')),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  maxRetryWaitMs: z.coerce.number().int().min(0).max(300_000).default(30_000),
  batchConcurrency: z.coerce.number().int().min(1).max(10).default(5),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    apiUrl: process.env.CADDIS_API_URL,
    username: process.env.CADDIS_USERNAME,
    password: process.env.CADDIS_PASSWORD,
    companyId: process.env.CADDIS_COMPANY_ID,
    maxRetries: process.env.CADDIS_MAX_RETRIES,
    maxRetryWaitMs: process.env.CADDIS_MAX_RETRY_WAIT_MS,
    batchConcurrency: process.env.CADDIS_BATCH_CONCURRENCY,
  });
}
