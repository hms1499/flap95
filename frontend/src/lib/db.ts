import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

let client: Sql | undefined;

// Lazy init so route modules can be imported at build time without DATABASE_URL.
export const sql: Sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
  client ??= neon(process.env.DATABASE_URL!);
  return client(strings, ...params);
}) as Sql;
