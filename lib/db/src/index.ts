import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";
import * as schema from "./schema";

const { Pool: PoolCtor } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Database operations will fail at runtime.");
}

export const pool: Pool = process.env.DATABASE_URL
  ? new PoolCtor({ connectionString: process.env.DATABASE_URL })
  : ({} as Pool);
export const db = drizzle(pool, { schema });

export * from "./schema";
