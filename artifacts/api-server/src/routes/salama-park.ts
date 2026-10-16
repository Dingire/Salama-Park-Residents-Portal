import { clerkClient, getAuth } from "@clerk/express";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  lt,
  or,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  announcementsTable,
  auditLogsTable,
  governanceDocumentsTable,
  membershipApplicationsTable,
  petitionConfigurationsTable,
  petitionSubmissionsTable,
  profilesTable,
  registerSnapshotsTable,
} from "@workspace/db";
import {
  GetMyResidentApplicationResponse,
  GetMyPetitionReceiptsResponse,
  GetAdminAccessResponse,
  GetAdminApplicationsQueryParams,
  GetAdminApplicationsResponse,
  GetAdminDashboardResponse,
  GetPublicAnnouncementsResponse,
  GetPublicDocumentsResponse,
  GetPublicOverviewResponse,
  GetPublicPetitionResponse,
  SubmitPetitionConsentBody,
  SubmitPetitionConsentResponse,
  SubmitResidentApplicationBody,
  SubmitResidentApplicationResponse,
  ReviewMembershipApplicationBody,
  ReviewMembershipApplicationParams,
  ReviewMembershipApplicationResponse,
  WithdrawMyPetitionSignatureResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getAuthenticatedUserId(
  req: Request,
  res: Response,
): string | null {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return userId;
}

function getPetitionState(config: {
  status: "draft" | "approved" | "closed";
  openingAt: Date | null;
  closingAt: Date | null;
}) {
  const now = new Date();
  if (config.status !== "approved" || !config.openingAt || !config.closingAt) {
    return "not-configured" as const;
  }
  if (now < config.openingAt) return "scheduled" as const;
  if (now >= config.closingAt) {
    return "closed" as const;
  }
  return "open" as const;
}

const allAssociationRoles = [
  "admin",
  "administrator",
  "returning-officer",
  "scrutineer",
] as const;

async function getAssociationRoles(userId: string): Promise<string[]> {
  const user = await clerkClient.users.getUser(userId);
  const roleClaim = user.publicMetadata.role;
  const candidates = Array.isArray(roleClaim) ? roleClaim : [roleClaim];
  return candidates.filter(
    (role): role is string =>
      typeof role === "string" && allAssociationRoles.includes(role as (typeof allAssociationRoles)[number]),
  );
}

function hasRole(roles: string[], ...required: string[]) {
  return required.some((role) => roles.includes(role));
}

router.get("/public/overview", async (_req, res): Promise<void> => {
  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);

  const [snapshot] = await db
    .select({ denominator: registerSnapshotsTable.denominator })
    .from(registerSnapshotsTable)
    .orderBy(desc(registerSnapshotsTable.approvedAt))
    .limit(1);

  let acceptedPetitionSignatures = 0;
  if (config) {
    const [total] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .where(
        and(
          eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
          eq(petitionSubmissionsTable.status, "accepted"),
        ),
      );
    acceptedPetitionSignatures = total?.value ?? 0;
  }

  res.json(
    GetPublicOverviewResponse.parse({
      membershipVerificationProgress: !snapshot,
      denominator: snapshot?.denominator ?? null,
      acceptedPetitionSignatures,
      petitionStatus: config ? getPetitionState(config) : "not-configured",
      proposedThreshold: config?.proposedThreshold ?? null,
    }),
  );
});

router.get("/public/documents", async (_req, res): Promise<void> => {
  const documents = await db
    .select({
      id: governanceDocumentsTable.id,
      title: governanceDocumentsTable.title,
      category: governanceDocumentsTable.category,
      version: governanceDocumentsTable.version,
      description: governanceDocumentsTable.description,
      publishedAt: governanceDocumentsTable.publishedAt,
      downloadUrl: governanceDocumentsTable.downloadUrl,
    })
    .from(governanceDocumentsTable)
    .where(eq(governanceDocumentsTable.publicationStatus, "published"))
    .orderBy(desc(governanceDocumentsTable.publishedAt));

  res.json(GetPublicDocumentsResponse.parse(documents));
});

router.get("/public/announcements", async (_req, res): Promise<void> => {
  const now = new Date();
  const announcements = await db
    .select({
      id: announcementsTable.id,
      title: announcementsTable.title,
      body: announcementsTable.body,
      publishedAt: announcementsTable.publishedAt,
    })
    .from(announcementsTable)
    .where(
      and(
        eq(announcementsTable.publicationStatus, "published"),
        lt(announcementsTable.publishedAt, now),
      ),
    )
    .orderBy(desc(announcementsTable.publishedAt));

  res.json(GetPublicAnnouncementsResponse.parse(announcements));
});

router.get("/public/petition", async (_req, res): Promise<void> => {
  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);

  if (!config) {
    res.json(
      GetPublicPetitionResponse.parse({
        status: "not-configured",
        openingDate: null,
        closingDate: null,
        eligibilityText: null,
        constitutionVersion: null,
        petitionVersion: null,
        signingEnabled: false,
        proposedThreshold: null,
      }),
    );
    return;
  }

  const status = getPetitionState(config);
  res.json(
    GetPublicPetitionResponse.parse({
      status,
      openingDate: config.openingAt,
      closingDate: config.closingAt,
      eligibilityText: config.eligibilityText,
      constitutionVersion: config.constitutionVersion,
      petitionVersion: config.petitionVersion,
      signingEnabled: status === "open",
      proposedThreshold: config.proposedThreshold,
    }),
  );
});

router.get("/resident/application/me", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  const [application] = await db
    .select({
      id: membershipApplicationsTable.id,
      reference: membershipApplicationsTable.reference,
      status: membershipApplicationsTable.status,
      submittedAt: membershipApplicationsTable.submittedAt,
    })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  res.json(GetMyResidentApplicationResponse.parse({ application: application ?? null }));
});

router.post("/resident/application", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  const parsed = SubmitResidentApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the application details and try again." });
    return;
  }

  const input = parsed.data;
  if (!input.privacyNoticeAccepted) {
    res.status(400).json({ error: "Accept the privacy notice to submit an application." });
    return;
  }
  if (!input.livesInSalamaPark) {
    res.status(400).json({ error: "This application is for current Salama Park residents." });
    return;
  }
  if (input.identityReference?.trim()) {
    res.status(400).json({
      error:
        "Identity reference details are not being collected until the Association formally approves the requirement.",
    });
    return;
  }
  if (input.preferredNotification === "sms") {
    res.status(400).json({
      error:
        "SMS notifications are not configured yet. Choose email or no notifications for now.",
    });
    return;
  }

  const reference = `SPRA-${randomUUID().slice(0, 8).toUpperCase()}`;
  const submittedAt = new Date();

  try {
    const created = await db.transaction(async (tx) => {
      await tx.insert(profilesTable).values({ id: userId }).onConflictDoNothing();
      const [application] = await tx
        .insert(membershipApplicationsTable)
        .values({
          reference,
          userId,
          fullName: input.fullName.trim(),
          houseNumber: input.houseNumber.trim(),
          streetOrZone: input.streetOrZone.trim(),
          phone: input.phone.trim(),
          email: input.email?.trim() || null,
          preferredNotification: input.preferredNotification,
          livesInSalamaPark: input.livesInSalamaPark,
          privacyNoticeAcceptedAt: submittedAt,
          submittedAt,
        })
        .returning({
          id: membershipApplicationsTable.id,
          reference: membershipApplicationsTable.reference,
          status: membershipApplicationsTable.status,
          submittedAt: membershipApplicationsTable.submittedAt,
        });

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "membership.application.submitted",
        recordType: "membership_application",
        recordId: application.id,
        metadata: JSON.stringify({ status: application.status }),
      });
      return application;
    });

    res
      .status(201)
      .json(SubmitResidentApplicationResponse.parse(created));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "23505") {
      res.status(409).json({
        error: "An application already exists for this account. Check its status from your resident dashboard.",
      });
      return;
    }
    throw error;
  }
});

router.post("/resident/petition", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  const parsed = SubmitPetitionConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Confirm each declaration before submitting your petition consent.",
    });
    return;
  }
  if (Object.values(parsed.data).some((value) => !value)) {
    res.status(400).json({
      error: "Confirm each declaration before submitting your petition consent.",
    });
    return;
  }

  const [application] = await db
    .select({ status: membershipApplicationsTable.status })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  if (application?.status !== "verified") {
    res.status(403).json({
      error: "Only verified members can submit petition consent. Check your application status first.",
    });
    return;
  }

  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .where(eq(petitionConfigurationsTable.status, "approved"))
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);

  if (!config) {
    res.status(422).json({
      error: "Petition signing is unavailable until approved petition and Constitution versions are published.",
    });
    return;
  }

  const status = getPetitionState(config);
  if (status !== "open") {
    res.status(409).json({ error: "The petition is not currently open for signatures." });
    return;
  }

  const reference = `PET-${randomUUID().slice(0, 10).toUpperCase()}`;
  const submittedAt = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.insert(profilesTable).values({ id: userId }).onConflictDoNothing();
      const [submission] = await tx
        .insert(petitionSubmissionsTable)
        .values({
          reference,
          userId,
          petitionConfigurationId: config.id,
          petitionVersion: config.petitionVersion,
          constitutionVersion: config.constitutionVersion,
          declarationVersion: "1",
          declarations: JSON.stringify(parsed.data),
          status: "accepted",
          submittedAt,
        })
        .returning({
          reference: petitionSubmissionsTable.reference,
          submittedAt: petitionSubmissionsTable.submittedAt,
          constitutionVersion: petitionSubmissionsTable.constitutionVersion,
          petitionVersion: petitionSubmissionsTable.petitionVersion,
          status: petitionSubmissionsTable.status,
        });
      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "petition.consent.submitted",
        recordType: "petition_submission",
        recordId: submission.reference,
        metadata: JSON.stringify({
          petitionVersion: submission.petitionVersion,
          constitutionVersion: submission.constitutionVersion,
        }),
      });
      return submission;
    });
    res.status(201).json(SubmitPetitionConsentResponse.parse(result));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "23505") {
      res.status(409).json({
        error: "An active signature has already been recorded for this petition.",
      });
      return;
    }
    throw error;
  }
});

router.get("/resident/petition/receipts", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  const receipts = await db
    .select({
      reference: petitionSubmissionsTable.reference,
      submittedAt: petitionSubmissionsTable.submittedAt,
      constitutionVersion: petitionSubmissionsTable.constitutionVersion,
      petitionVersion: petitionSubmissionsTable.petitionVersion,
      status: petitionSubmissionsTable.status,
    })
    .from(petitionSubmissionsTable)
    .where(eq(petitionSubmissionsTable.userId, userId))
    .orderBy(desc(petitionSubmissionsTable.submittedAt));

  res.json(GetMyPetitionReceiptsResponse.parse(receipts));
});

router.post("/resident/petition/withdraw", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;

  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .where(eq(petitionConfigurationsTable.status, "approved"))
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);
  if (!config || getPetitionState(config) !== "open") {
    res.status(409).json({
      error: "A petition signature can only be withdrawn before the published closing deadline.",
    });
    return;
  }

  const [signature] = await db
    .select({ id: petitionSubmissionsTable.id, reference: petitionSubmissionsTable.reference })
    .from(petitionSubmissionsTable)
    .where(
      and(
        eq(petitionSubmissionsTable.userId, userId),
        eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
        eq(petitionSubmissionsTable.status, "accepted"),
      ),
    )
    .limit(1);
  if (!signature) {
    res.status(409).json({ error: "No active signature was found for this petition." });
    return;
  }

  const withdrawnAt = new Date();
  const result = await db.transaction(async (tx) => {
    const [withdrawn] = await tx
      .update(petitionSubmissionsTable)
      .set({ status: "withdrawn", withdrawnAt })
      .where(
        and(
          eq(petitionSubmissionsTable.id, signature.id),
          eq(petitionSubmissionsTable.status, "accepted"),
        ),
      )
      .returning({
        reference: petitionSubmissionsTable.reference,
        status: petitionSubmissionsTable.status,
        withdrawnAt: petitionSubmissionsTable.withdrawnAt,
      });
    if (!withdrawn) return null;
    await tx.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "petition.signature.withdrawn",
      recordType: "petition_submission",
      recordId: signature.reference,
      metadata: JSON.stringify({ status: "withdrawn" }),
    });
    return withdrawn;
  });
  if (!result) {
    res.status(409).json({ error: "The signature has already been withdrawn or changed." });
    return;
  }

  res.json(WithdrawMyPetitionSignatureResponse.parse(result));
});

router.get("/admin/access", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  const role = ["administrator", "admin", "returning-officer", "scrutineer"].find((candidate) =>
    roles.includes(candidate),
  ) ?? null;
  res.json(
    GetAdminAccessResponse.parse({
      allowed: role !== null,
      role,
    }),
  );
});

router.get("/admin/dashboard", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, "admin", "administrator", "returning-officer", "scrutineer")) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }

  const applicationCounts = await db
    .select({
      status: membershipApplicationsTable.status,
      value: count(),
    })
    .from(membershipApplicationsTable)
    .groupBy(membershipApplicationsTable.status);
  const counts = new Map(applicationCounts.map((item) => [item.status, item.value]));

  const [totalApplications] = await db
    .select({ value: count() })
    .from(membershipApplicationsTable);
  const [snapshot] = await db
    .select({ denominator: registerSnapshotsTable.denominator })
    .from(registerSnapshotsTable)
    .orderBy(desc(registerSnapshotsTable.approvedAt))
    .limit(1);
  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);
  let acceptedPetitionSignatures = 0;
  if (config) {
    const [signatures] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .where(
        and(
          eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
          eq(petitionSubmissionsTable.status, "accepted"),
        ),
      );
    acceptedPetitionSignatures = signatures?.value ?? 0;
  }

  res.json(
    GetAdminDashboardResponse.parse({
      totalApplications: totalApplications?.value ?? 0,
      pendingApplications: counts.get("pending-verification") ?? 0,
      clarificationRequested: counts.get("clarification-requested") ?? 0,
      verifiedApplications: counts.get("verified") ?? 0,
      rejectedApplications: counts.get("rejected") ?? 0,
      acceptedPetitionSignatures,
      verifiedDenominator: snapshot?.denominator ?? null,
      petitionStatus: config ? getPetitionState(config) : "not-configured",
    }),
  );
});

router.get("/admin/applications", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, "admin", "administrator", "returning-officer", "scrutineer")) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }
  const query = GetAdminApplicationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Check the application search and filters." });
    return;
  }

  const filters = [];
  if (query.data.status) {
    filters.push(eq(membershipApplicationsTable.status, query.data.status));
  }
  if (query.data.search?.trim()) {
    const term = `%${query.data.search.trim()}%`;
    filters.push(
      or(
        ilike(membershipApplicationsTable.fullName, term),
        ilike(membershipApplicationsTable.reference, term),
        ilike(membershipApplicationsTable.houseNumber, term),
        ilike(membershipApplicationsTable.streetOrZone, term),
      ),
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const [total] = await db
    .select({ value: count() })
    .from(membershipApplicationsTable)
    .where(where);
  const items = await db
    .select({
      id: membershipApplicationsTable.id,
      reference: membershipApplicationsTable.reference,
      fullName: membershipApplicationsTable.fullName,
      houseNumber: membershipApplicationsTable.houseNumber,
      streetOrZone: membershipApplicationsTable.streetOrZone,
      phone: membershipApplicationsTable.phone,
      email: membershipApplicationsTable.email,
      status: membershipApplicationsTable.status,
      submittedAt: membershipApplicationsTable.submittedAt,
      decisionReason: membershipApplicationsTable.decisionReason,
    })
    .from(membershipApplicationsTable)
    .where(where)
    .orderBy(desc(membershipApplicationsTable.submittedAt))
    .limit(query.data.pageSize)
    .offset((query.data.page - 1) * query.data.pageSize);

  res.json(
    GetAdminApplicationsResponse.parse({
      items,
      page: query.data.page,
      pageSize: query.data.pageSize,
      total: total?.value ?? 0,
    }),
  );
});

router.post("/admin/applications/:id/review", async (req, res): Promise<void> => {
  const userId = getAuthenticatedUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, "admin", "administrator", "returning-officer")) {
    res.status(403).json({ error: "Returning Officer or administrator access is required." });
    return;
  }

  const params = ReviewMembershipApplicationParams.safeParse(req.params);
  const body = ReviewMembershipApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid decision and a reason for the record." });
    return;
  }

  const reviewedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const [application] = await tx
      .update(membershipApplicationsTable)
      .set({
        status: body.data.status,
        decisionReason: body.data.reason.trim(),
        reviewedBy: userId,
        reviewedAt,
        updatedAt: reviewedAt,
      })
      .where(eq(membershipApplicationsTable.id, params.data.id))
      .returning({
        id: membershipApplicationsTable.id,
        reference: membershipApplicationsTable.reference,
        fullName: membershipApplicationsTable.fullName,
        houseNumber: membershipApplicationsTable.houseNumber,
        streetOrZone: membershipApplicationsTable.streetOrZone,
        phone: membershipApplicationsTable.phone,
        email: membershipApplicationsTable.email,
        status: membershipApplicationsTable.status,
        submittedAt: membershipApplicationsTable.submittedAt,
        decisionReason: membershipApplicationsTable.decisionReason,
      });
    if (!application) return null;

    await tx.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "membership.application.reviewed",
      recordType: "membership_application",
      recordId: application.id,
      metadata: JSON.stringify({
        status: application.status,
        reason: body.data.reason.trim(),
      }),
    });
    return application;
  });
  if (!result) {
    res.status(404).json({ error: "Membership application not found." });
    return;
  }
  res.json(ReviewMembershipApplicationResponse.parse(result));
});

export default router;
