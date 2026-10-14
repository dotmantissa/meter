import { neon } from '@neondatabase/serverless';
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('CONFIG_DATABASE');
  return neon(url);
}
