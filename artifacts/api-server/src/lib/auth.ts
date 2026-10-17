import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import { db, userRolesTable } from "@workspace/db";

/**
 * Association roles that grant access to privileged workflows. The reserved
 * "administrator" role is the broadest association administration role.
 */
export const adminRoles = [
  "admin",
  "administrator",
  "returning-officer",
  "scrutineer",
] as const;

export const reviewerRoles = [
  "admin",
  "administrator",
  "returning-officer",
] as const;

/**
 * Clerk is optional for local development. When no secret key is configured the
 * portal still serves its public information, but every authenticated action
 * reports "sign in required".
 */
export const clerkEnabled = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY,
);

export function getAuthUserId(req: Request): string | null {
  if (!clerkEnabled) return null;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

function bootstrapAdminIds(): string[] {
  const raw =
    process.env.BOOTSTRAP_ADMIN_USER_IDS ??
    process.env.BOOTSTRAP_ADMIN_USER_ID ??
    "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Resolve the association roles a signed-in account holds. Roles are stored in
 * the database so the association can manage access without depending on a
 * third-party dashboard. Clerk public metadata is still honoured as a fallback
 * for accounts provisioned before the role register existed.
 */
export async function getAssociationRoles(userId: string): Promise<string[]> {
  const roles = new Set<string>();

  const roleRows = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(
      and(
        eq(userRolesTable.userId, userId),
        isNull(userRolesTable.revokedAt),
      ),
    );
  for (const row of roleRows) roles.add(row.role);

  if (bootstrapAdminIds().includes(userId)) roles.add("administrator");

  if (clerkEnabled && roles.size === 0) {
    try {
      const user = await clerkClient.users.getUser(userId);
      const roleClaim = user.publicMetadata.role;
      const candidates = Array.isArray(roleClaim) ? roleClaim : [roleClaim];
      for (const candidate of candidates) {
        if (
          typeof candidate === "string" &&
          adminRoles.includes(candidate as (typeof adminRoles)[number])
        ) {
          roles.add(candidate);
        }
      }
    } catch {
      // Metadata lookup is best-effort only.
    }
  }

  return [...roles];
}

export function hasRole(roles: string[], ...required: string[]) {
  return required.some((role) => roles.includes(role));
}
