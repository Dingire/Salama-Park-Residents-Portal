import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { membershipApplicationsTable } from "@workspace/db/schema";
import { financeRoles, getAssociationRoles, getAuthUserId, hasRole } from "../lib/auth";

async function requireFinanceUserForGeo(req: Request, res: Response): Promise<string | null> {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in required." });
    return null;
  }
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...financeRoles)) {
    res.status(403).json({ error: "An administrator or treasurer role is required." });
    return null;
  }
  return userId;
}

const router = Router();

/**
 * Admin-only street stats for the geo heatmap.
 * Groups by normalized street_or_zone and returns counts.
 * Only includes non-rejected applications by default.
 */
router.get("/admin/geo/street-stats", async (req: Request, res: Response): Promise<void> => {
  if (!(await requireFinanceUserForGeo(req, res))) return;

  const includeAll = req.query.includeAll === "true";
  const includeVerifiedOnly = req.query.verifiedOnly !== "false" && !includeAll;

  const conditions = [sql`TRIM(COALESCE(${membershipApplicationsTable.streetOrZone}, '')) <> ''`];
  
  if (includeVerifiedOnly) {
    conditions.push(eq(membershipApplicationsTable.status, "verified"));
  } else if (!includeAll) {
    conditions.push(sql`${membershipApplicationsTable.status} != 'rejected'`);
  }

  const rows = await db
    .select({
      key: sql<string>`LOWER(TRIM(${membershipApplicationsTable.streetOrZone}))`,
      label: sql<string>`MAX(TRIM(${membershipApplicationsTable.streetOrZone}))`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(membershipApplicationsTable)
    .where(and(...conditions))
    .groupBy(sql`LOWER(TRIM(${membershipApplicationsTable.streetOrZone}))`)
    .orderBy(sql`COUNT(*) DESC`, sql`MAX(TRIM(${membershipApplicationsTable.streetOrZone}))`);

  res.json({
    streets: rows.map((r) => ({
      key: r.key,
      label: r.label,
      count: r.count,
      lat: null,
      lng: null,
    })),
  });
});

export default router;
