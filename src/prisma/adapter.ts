import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Rust-free Prisma client (engineType "client") runs over the MariaDB/MySQL driver.
 * No native query engine to bundle, which keeps Vercel functions small.
 * Works with TiDB Cloud (MySQL protocol); set DB_SSL=true there.
 */
export function mariaDbAdapter(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(databaseUrl);
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 5),
    // Fail fast instead of hanging a request when the database is unreachable.
    connectTimeout: 5000,
    acquireTimeout: 8000,
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
