import { existsSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { errorMessageChain } from "./pg-errors";

/**
 * True when any error in the wrapper chain mentions the given text. Drizzle
 * wraps driver errors, so the actionable message is usually on the cause.
 */
function migrationErrorMentions(error: unknown, text: string): boolean {
  return errorMessageChain(error).some((message) => message.includes(text));
}

/**
 * Apply the committed Drizzle migrations on boot. This keeps a fresh Railway
 * deployment (or a new database) in step with the schema without a manual step.
 * Set RUN_MIGRATIONS=false to skip.
 */
export async function runMigrations(): Promise<void> {
  if (process.env.RUN_MIGRATIONS === "false") {
    logger.info("RUN_MIGRATIONS=false — skipping database migrations");
    return;
  }

  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "lib/db/drizzle"),
    path.resolve(process.cwd(), "../../lib/db/drizzle"),
  ].filter((value): value is string => Boolean(value));

  const migrationsFolder = candidates.find((dir) => existsSync(dir));
  if (!migrationsFolder) {
    logger.warn(
      { candidates },
      "No Drizzle migrations folder found; skipping migrations",
    );
    return;
  }

  try {
    await migrate(db, { migrationsFolder });
    logger.info({ migrationsFolder }, "Database migrations applied");
  } catch (err: any) {
    // Drizzle wraps the Postgres error, so the "already exists" text lives on
    // the cause rather than on the top-level message.
    if (migrationErrorMentions(err, "already exists")) {
      logger.warn({ err }, "Migrations skipped: schema objects already exist");
      return;
    }
    logger.error({ err }, "Failed to apply database migrations");
    throw err;
  }
}
