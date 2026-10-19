import { logger } from "./logger";

/**
 * Optional Google Sheets mirror.
 *
 * The Postgres database is the source of truth. When a Google Apps Script web
 * app URL is configured, each registration / petition / subscription is pushed
 * there so the committee keeps its familiar spreadsheet workflow alongside the
 * database. Everything here is fire-and-forget: a mirror failure must never
 * block or fail a resident's request.
 *
 * Required Railway environment variables (both optional — sync is skipped when
 * the URL is unset):
 *   GOOGLE_SHEETS_WEBHOOK_URL    — the Apps Script web app deployment URL
 *   GOOGLE_SHEETS_WEBHOOK_SECRET — a shared secret checked by the script
 */

const REQUEST_TIMEOUT_MS = 20000;
const ATTEMPTS = 3;

function getConfig(): { url: string; secret: string } | null {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  if (!url) return null;
  return {
    url,
    secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim() ?? "",
  };
}

/**
 * Append the shared secret as a query parameter.
 *
 * Apps Script deployments appear to drop custom request headers before they
 * reach `doPost`, so the header-based check is unreliable. The script accepts
 * `?secret=` as well, so send it both ways: the query parameter guarantees the
 * push is authorised, and the header remains for older script versions.
 */
function withSecret(url: string, secret: string): string {
  if (!secret) return url;
  const target = new URL(url);
  target.searchParams.set("secret", secret);
  return target.toString();
}

export type GoogleSheetsRowKind =
  | "registration"
  | "petition"
  | "subscription"
  | "verification";

export interface GoogleSheetsPayload {
  kind: GoogleSheetsRowKind;
  reference: string;
  submittedAt: string;
  fields: Record<string, string | number | boolean | null>;
}

export function isGoogleSheetsSyncEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Push a single record to the Google Sheet. Never throws; failures are logged
 * so the committee's IT volunteer can spot a broken hook in the Railway logs.
 *
 * Apps Script cold starts can take several seconds, so each push is retried a
 * few times before giving up. A dropped row is only ever a mirror gap — the
 * database remains the source of truth.
 */
export async function pushToGoogleSheets(
  payload: GoogleSheetsPayload,
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(withSecret(config.url, config.secret), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": config.secret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (response.ok) {
        const body = (await response.text()).trim();
        if (body === "ok") return;
        logger.warn(
          { status: response.status, body: body.slice(0, 200), kind: payload.kind },
          "Google Sheets mirror rejected the push",
        );
        return;
      }
      logger.warn(
        { status: response.status, attempt, kind: payload.kind },
        "Google Sheets mirror returned a non-2xx response",
      );
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : error,
          attempt,
          kind: payload.kind,
        },
        "Google Sheets mirror push failed (non-fatal)",
      );
    }

    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}
