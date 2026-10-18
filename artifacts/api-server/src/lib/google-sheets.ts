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

const REQUEST_TIMEOUT_MS = 6000;

function getConfig(): { url: string; secret: string } | null {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();
  if (!url) return null;
  return {
    url,
    secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim() ?? "",
  };
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
 */
export async function pushToGoogleSheets(
  payload: GoogleSheetsPayload,
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": config.secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      logger.warn(
        { status: response.status, kind: payload.kind },
        "Google Sheets mirror returned a non-2xx response",
      );
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error, kind: payload.kind },
      "Google Sheets mirror push failed (non-fatal)",
    );
  }
}
