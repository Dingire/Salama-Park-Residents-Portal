import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  announcementsTable,
  auditLogsTable,
  financeChargesTable,
  financeExpensesTable,
  financePaymentsTable,
  financePeriodsTable,
  governanceDocumentsTable,
  membershipApplicationsTable,
  petitionConfigurationsTable,
  petitionSubmissionsTable,
  profilesTable,
  registerSnapshotsTable,
  userRolesTable,
} from "@workspace/db";
import {
  getAssociationRoles,
  getAuthUserId,
  hasRole,
  adminRoles,
  reviewerRoles,
  financeRoles,
} from "../lib/auth";
import { pushToGoogleSheets } from "../lib/google-sheets";
import { isUniqueViolation } from "../lib/pg-errors";
import { calculatePetitionThresholds } from "../salama-park-rules";
import {
  GetMyResidentApplicationResponse,
  GetMyPetitionReceiptsResponse,
  GetAdminAccessResponse,
  GetAdminApplicationsQueryParams,
  GetAdminApplicationsResponse,
  GetAdminDashboardResponse,
  GetAdminPetitionSubmissionsQueryParams,
  GetAdminPetitionSubmissionsResponse,
  GetPublicAnnouncementsResponse,
  GetPublicDocumentsResponse,
  GetPublicOverviewResponse,
  GetPublicPetitionResponse,
  GetPublicPollResultsResponse,
  SubmitPetitionConsentBody,
  SubmitPetitionConsentResponse,
  SubmitResidentApplicationBody,
  SubmitResidentApplicationResponse,
  ReviewMembershipApplicationBody,
  ReviewMembershipApplicationParams,
  ReviewMembershipApplicationResponse,
  VerifyPetitionSubmissionBody,
  VerifyPetitionSubmissionParams,
  VerifyPetitionSubmissionResponse,
  WithdrawMyPetitionSignatureResponse,
  GetAdminRegisterSnapshotsResponse,
  CreateAdminRegisterSnapshotBody,
  CreateAdminRegisterSnapshotResponse,
  GetAdminPetitionConfigurationResponse,
  SaveAdminPetitionConfigurationBody,
  SaveAdminPetitionConfigurationResponse,
  ApproveAdminPetitionConfigurationResponse,
  CloseAdminPetitionConfigurationResponse,
  GetAdminRolesResponse,
  GrantAdminRoleBody,
  GrantAdminRoleResponse,
  RevokeAdminRoleBody,
  RevokeAdminRoleResponse,
  GetAdminFinanceOverviewResponse,
  GetAdminFinancePeriodsResponse,
  CreateAdminFinancePeriodBody,
  CreateAdminFinancePeriodResponse,
  GenerateAdminFinanceChargesParams,
  GenerateAdminFinanceChargesResponse,
  GetAdminFinanceChargesQueryParams,
  GetAdminFinanceChargesResponse,
  RecordAdminFinancePaymentParams,
  RecordAdminFinancePaymentBody,
  RecordAdminFinancePaymentResponse,
  WaiveAdminFinanceChargeParams,
  WaiveAdminFinanceChargeBody,
  WaiveAdminFinanceChargeResponse,
  GetAdminFinanceExpensesQueryParams,
  GetAdminFinanceExpensesResponse,
  CreateAdminFinanceExpenseBody,
  CreateAdminFinanceExpenseResponse,
  DeleteAdminFinanceExpenseParams,
  DeleteAdminFinanceExpenseResponse,
  GetMySubscriptionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function requireUserId(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = getAuthUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Please sign in to view or access these details." });
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

const DECLARATION_KEYS = [
  "readConstitution",
  "consentToVersion",
  "truthfulResidency",
  "understandDataUse",
  "understandFoundingProvisions",
  "understandWithdrawal",
  "voluntary",
] as const;

type SubscriptionVoteValue = "k50" | "k100" | "k150";

/**
 * Subscription poll metrics.
 *
 * The poll is now collected during registration (Section D), so the source of
 * truth is the membership register rather than the petition table. Rejected
 * applications are excluded; pending and verified applications both count so
 * the public poll reflects every valid application without waiting for manual
 * verification.
 */
async function computePollMetrics() {
  const countedFilter = sql`${membershipApplicationsTable.status} <> 'rejected'`;

  const grouped = await db
    .select({
      subscriptionVote: membershipApplicationsTable.subscriptionVote,
      residencyStatus: membershipApplicationsTable.residencyStatus,
      value: count(),
    })
    .from(membershipApplicationsTable)
    .where(countedFilter)
    .groupBy(
      membershipApplicationsTable.subscriptionVote,
      membershipApplicationsTable.residencyStatus,
    );

  let votesK50 = 0;
  let votesK100 = 0;
  let votesK150 = 0;
  let homeowners = 0;
  let tenants = 0;
  for (const row of grouped) {
    if (row.subscriptionVote === "k50") votesK50 += row.value;
    if (row.subscriptionVote === "k100") votesK100 += row.value;
    if (row.subscriptionVote === "k150") votesK150 += row.value;
    if (
      row.residencyStatus === "owner-occupier" ||
      row.residencyStatus === "owner-landlord"
    ) {
      homeowners += row.value;
    }
    if (row.residencyStatus === "tenant") tenants += row.value;
  }

  const [volunteerRow] = await db
    .select({ value: count() })
    .from(membershipApplicationsTable)
    .where(
      and(
        countedFilter,
        eq(membershipApplicationsTable.willingToVolunteer, true),
      ),
    );
  const [onlineVotingRow] = await db
    .select({ value: count() })
    .from(membershipApplicationsTable)
    .where(
      and(
        countedFilter,
        eq(membershipApplicationsTable.declarationVoterRoll, true),
      ),
    );
  const [adultsRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${membershipApplicationsTable.adultsInHousehold}), 0)`,
    })
    .from(membershipApplicationsTable)
    .where(countedFilter);

  const totalVotes = votesK50 + votesK100 + votesK150;
  const percentage = (value: number) =>
    totalVotes > 0 ? Math.round((value / totalVotes) * 1000) / 10 : 0;

  let currentWinner: SubscriptionVoteValue | null = null;
  if (totalVotes > 0) {
    const highest = Math.max(votesK50, votesK100, votesK150);
    const leaders: SubscriptionVoteValue[] = [];
    if (votesK50 === highest) leaders.push("k50");
    if (votesK100 === highest) leaders.push("k100");
    if (votesK150 === highest) leaders.push("k150");
    currentWinner = leaders.length === 1 ? leaders[0] : null;
  }

  return {
    totalVotes,
    votesK50,
    votesK100,
    votesK150,
    percentageK50: percentage(votesK50),
    percentageK100: percentage(votesK100),
    percentageK150: percentage(votesK150),
    currentWinner,
    homeowners,
    tenants,
    totalAdults: Number(adultsRow?.total ?? 0),
    volunteers: volunteerRow?.value ?? 0,
    onlineVotingConsent: onlineVotingRow?.value ?? 0,
  };
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
  let rejectedPetitionSignatures = 0;
  let disputedPetitionSignatures = 0;
  let withdrawnPetitionSignatures = 0;
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
    const [rejected] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .where(
        and(
          eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
          eq(petitionSubmissionsTable.status, "rejected"),
        ),
      );
    const [disputed] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .where(
        and(
          eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
          eq(petitionSubmissionsTable.status, "disputed"),
        ),
      );
    const [withdrawn] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .where(
        and(
          eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
          eq(petitionSubmissionsTable.status, "withdrawn"),
        ),
      );
    acceptedPetitionSignatures = total?.value ?? 0;
    rejectedPetitionSignatures = rejected?.value ?? 0;
    disputedPetitionSignatures = disputed?.value ?? 0;
    withdrawnPetitionSignatures = withdrawn?.value ?? 0;
  }

  const denominator = snapshot?.denominator ?? null;
  const proposedThreshold = config?.proposedThreshold ?? null;
  // The constitution sets the adoption bar at two thirds of the verified
  // register, so that figure — not the administratively proposed number —
  // decides whether the threshold is reached. `proposedThreshold` is reported
  // for information only.
  const thresholds = calculatePetitionThresholds(
    denominator,
    acceptedPetitionSignatures,
  );

  res.json(
    GetPublicOverviewResponse.parse({
      membershipVerificationProgress: !snapshot,
      denominator,
      acceptedPetitionSignatures,
      rejectedPetitionSignatures,
      disputedPetitionSignatures,
      withdrawnPetitionSignatures,
      petitionStatus: config ? getPetitionState(config) : "not-configured",
      proposedThreshold,
      twoThirdsThreshold: thresholds.twoThirdsThreshold,
      minimumQuorum: thresholds.minimumQuorum,
      signaturesRemaining: thresholds.signaturesRemaining,
      thresholdReached: thresholds.thresholdReached,
      supportPercentage: thresholds.supportPercentage,
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

router.get("/public/poll", async (_req, res): Promise<void> => {
  const metrics = await computePollMetrics();
  res.json(GetPublicPollResultsResponse.parse(metrics));
});

router.get("/resident/application/me", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const [application] = await db
    .select({
      id: membershipApplicationsTable.id,
      reference: membershipApplicationsTable.reference,
      status: membershipApplicationsTable.status,
      submittedAt: membershipApplicationsTable.submittedAt,
      subscriptionVote: membershipApplicationsTable.subscriptionVote,
    })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  res.json(GetMyResidentApplicationResponse.parse({ application: application ?? null }));
});

router.put("/resident/application/documents", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const body = (req.body ?? {}) as Record<string, unknown>;

  const [application] = await db
    .select({
      id: membershipApplicationsTable.id,
    })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  if (!application) {
    res.status(404).json({ error: "Membership application not found." });
    return;
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };

  if ("identityDocumentDataUrl" in body)
    update.identityDocumentDataUrl =
      body.identityDocumentDataUrl === null || body.identityDocumentDataUrl === undefined
        ? null
        : String(body.identityDocumentDataUrl);
  if ("identityDocumentName" in body)
    update.identityDocumentName =
      body.identityDocumentName === null || body.identityDocumentName === undefined
        ? null
        : String(body.identityDocumentName);
  if ("identityDocumentMimeType" in body)
    update.identityDocumentMimeType =
      body.identityDocumentMimeType === null || body.identityDocumentMimeType === undefined
        ? null
        : String(body.identityDocumentMimeType);

  if ("proofOfResidenceDataUrl" in body)
    update.proofOfResidenceDataUrl =
      body.proofOfResidenceDataUrl === null || body.proofOfResidenceDataUrl === undefined
        ? null
        : String(body.proofOfResidenceDataUrl);
  if ("proofOfResidenceName" in body)
    update.proofOfResidenceName =
      body.proofOfResidenceName === null || body.proofOfResidenceName === undefined
        ? null
        : String(body.proofOfResidenceName);
  if ("proofOfResidenceMimeType" in body)
    update.proofOfResidenceMimeType =
      body.proofOfResidenceMimeType === null || body.proofOfResidenceMimeType === undefined
        ? null
        : String(body.proofOfResidenceMimeType);

  if ("passportPhotoDataUrl" in body)
    update.passportPhotoDataUrl =
      body.passportPhotoDataUrl === null || body.passportPhotoDataUrl === undefined
        ? null
        : String(body.passportPhotoDataUrl);
  if ("passportPhotoName" in body)
    update.passportPhotoName =
      body.passportPhotoName === null || body.passportPhotoName === undefined
        ? null
        : String(body.passportPhotoName);
  if ("passportPhotoMimeType" in body)
    update.passportPhotoMimeType =
      body.passportPhotoMimeType === null || body.passportPhotoMimeType === undefined
        ? null
        : String(body.passportPhotoMimeType);

  if ("proofOfTenureDataUrl" in body)
    update.proofOfTenureDataUrl =
      body.proofOfTenureDataUrl === null || body.proofOfTenureDataUrl === undefined
        ? null
        : String(body.proofOfTenureDataUrl);
  if ("proofOfTenureName" in body)
    update.proofOfTenureName =
      body.proofOfTenureName === null || body.proofOfTenureName === undefined
        ? null
        : String(body.proofOfTenureName);
  if ("proofOfTenureMimeType" in body)
    update.proofOfTenureMimeType =
      body.proofOfTenureMimeType === null || body.proofOfTenureMimeType === undefined
        ? null
        : String(body.proofOfTenureMimeType);

  if ("idDocumentDataUrl" in body)
    update.idDocumentDataUrl =
      body.idDocumentDataUrl === null || body.idDocumentDataUrl === undefined
        ? null
        : String(body.idDocumentDataUrl);
  if ("idDocumentName" in body)
    update.idDocumentName =
      body.idDocumentName === null || body.idDocumentName === undefined
        ? null
        : String(body.idDocumentName);
  if ("idDocumentMimeType" in body)
    update.idDocumentMimeType =
      body.idDocumentMimeType === null || body.idDocumentMimeType === undefined
        ? null
        : String(body.idDocumentMimeType);

  if (Object.keys(update).length <= 1) {
    res.status(400).json({ error: "No document updates provided." });
    return;
  }

  await db
    .update(membershipApplicationsTable)
    .set(update)
    .where(eq(membershipApplicationsTable.userId, userId));

  await db.insert(auditLogsTable).values({
    actorUserId: userId,
    action: "membership.application.documents.updated",
    recordType: "membership_application",
    recordId: application.id,
    metadata: JSON.stringify({ updatedAt: update.updatedAt }),
  });

  const [status] = await db
    .select({
      reference: membershipApplicationsTable.reference,
      status: membershipApplicationsTable.status,
      submittedAt: membershipApplicationsTable.submittedAt,
      subscriptionVote: membershipApplicationsTable.subscriptionVote,
    })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  if (!status) {
    res.status(404).json({ error: "Membership application not found." });
    return;
  }

  res.json({ application: status });
});

router.post("/resident/application", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  if (!input.livesInSalamaPark && input.membershipCategory === "full") {
    res.status(400).json({
      error:
        "Full membership requires current residence in Salama Park. Apply as an associate member if you are a non-resident property owner.",
    });
    return;
  }
  const nrcNumber = input.nrcNumber?.trim() || "";
  const passportNumber = input.passportNumber?.trim() || "";
  if (!nrcNumber && !passportNumber) {
    res.status(400).json({
      error:
        "Enter your NRC number, or your passport number if you do not hold an NRC.",
    });
    return;
  }
  const dateOfBirth = new Date(`${input.dateOfBirth}T00:00:00Z`);
  if (
    Number.isNaN(dateOfBirth.getTime()) ||
    dateOfBirth > new Date() ||
    dateOfBirth.getUTCFullYear() < 1900
  ) {
    res.status(400).json({ error: "Enter a valid date of birth." });
    return;
  }
  const declarationsConfirmed = [
    input.declarationConfirmResident,
    input.declarationReadConstitution,
    input.declarationMemberRegister,
    input.declarationVoterRoll,
    input.declarationContactConsent,
    input.declarationNoSubscription,
    input.declarationUndertakePayment,
    input.declarationUnderstandRelief,
  ].every((value) => value === true);
  if (!declarationsConfirmed) {
    res.status(400).json({
      error: "Confirm each declaration before submitting your application.",
    });
    return;
  }
  if (!input.livesInSalamaPark && !input.principalResidenceAddress?.trim()) {
    res.status(400).json({
      error: "Provide the address of your principal residence.",
    });
    return;
  }
  if (
    (input.membershipCategory === "associate" ||
      input.membershipCategory === "honorary") &&
    !input.associationBasis?.trim()
  ) {
    res.status(400).json({
      error: "Describe the basis of your association with Salama Park.",
    });
    return;
  }
  if (input.membershipCategory === "honorary" && !input.nominatedBy?.trim()) {
    res.status(400).json({
      error:
        "Provide the member or body that nominated you for honorary membership.",
    });
    return;
  }
  if (input.otherAssociationMember && !input.otherAssociationName?.trim()) {
    res.status(400).json({
      error: "Name the other residents association you belong to.",
    });
    return;
  }
  const emergencyContactName = input.emergencyContactName?.trim() || "";
  const emergencyContactPhone = input.emergencyContactPhone?.trim() || "";
  const emergencyContactRelationship =
    input.emergencyContactRelationship?.trim() || "";
  if (
    (emergencyContactName ||
      emergencyContactPhone ||
      emergencyContactRelationship) &&
    !(
      emergencyContactName &&
      emergencyContactPhone &&
      emergencyContactRelationship
    )
  ) {
    res.status(400).json({
      error:
        "Complete the emergency contact name, phone number and relationship, or leave all three blank.",
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
    const created = await db.transaction(async (tx: any) => {
      await tx.insert(profilesTable).values({ id: userId }).onConflictDoNothing();
      const [application] = await tx
        .insert(membershipApplicationsTable)
        .values({
          reference,
          userId,
          // Section A — Personal identification
          fullName: input.fullName.trim(),
          nrcNumber: nrcNumber || null,
          passportNumber: passportNumber || null,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          nationality: input.nationality.trim(),
          phone: input.phone.trim(),
          phoneAlt: input.phoneAlt?.trim() || null,
          email: input.email?.trim() || null,
          houseNumber: input.houseNumber.trim(),
          streetOrZone: input.streetOrZone.trim(),
          plotNumber: input.plotNumber?.trim() || null,
          // Section B — Residency
          livesInSalamaPark: input.livesInSalamaPark,
          residencyStatus: input.residencyStatus,
          residencySince: input.residencySince.trim(),
          ownsProperty: input.ownsProperty,
          propertyPlots: input.propertyPlots?.trim() || null,
          wardRegisteredVoter: input.wardRegisteredVoter ?? null,
          // Section C — Membership category
          membershipCategory: input.membershipCategory,
          otherAssociationMember: input.otherAssociationMember ?? null,
          otherAssociationName: input.otherAssociationMember
            ? input.otherAssociationName?.trim() || null
            : null,
          // Section D — Subscription poll
          subscriptionVote: input.subscriptionVote,
          agreeToPayAdopted: input.agreeToPayAdopted,
          reliefOption: input.reliefOption,
          paymentMethod: input.paymentMethod ?? null,
          // Section E — Declarations and signature
          declarationConfirmResident: true,
          declarationReadConstitution: true,
          declarationMemberRegister: true,
          declarationVoterRoll: true,
          declarationContactConsent: true,
          declarationNoSubscription: true,
          declarationUndertakePayment: true,
          declarationUnderstandRelief: true,
          signatureName: input.signatureName.trim(),
          // Section G — Associate and honorary members
          principalResidenceAddress:
            input.principalResidenceAddress?.trim() || null,
          associationBasis: input.associationBasis?.trim() || null,
          nominatedBy: input.nominatedBy?.trim() || null,
          // Section H — Optional planning and skills
          occupation: input.occupation?.trim() || null,
          willingToVolunteer: input.willingToVolunteer ?? false,
          volunteerSkills: input.volunteerSkills?.trim() || null,
          accessNeeds: input.accessNeeds?.trim() || null,
          preferredLanguage: input.preferredLanguage ?? null,
          // Additional household and emergency details
          adultsInHousehold: input.adultsInHousehold ?? null,
          emergencyContactName: emergencyContactName || null,
          emergencyContactPhone: emergencyContactPhone || null,
          emergencyContactRelationship: emergencyContactRelationship || null,
          preferredNotification: input.preferredNotification,
          privacyNoticeAcceptedAt: submittedAt,
          identityDocumentDataUrl: input.identityDocumentDataUrl ?? input.idDocumentDataUrl ?? null,
          identityDocumentName: input.identityDocumentName ?? input.idDocumentName ?? null,
          identityDocumentMimeType: input.identityDocumentMimeType ?? input.idDocumentMimeType ?? null,
          proofOfResidenceDataUrl: input.proofOfResidenceDataUrl ?? null,
          proofOfResidenceName: input.proofOfResidenceName ?? null,
          proofOfResidenceMimeType: input.proofOfResidenceMimeType ?? null,
          passportPhotoDataUrl: input.passportPhotoDataUrl ?? null,
          passportPhotoName: input.passportPhotoName ?? null,
          passportPhotoMimeType: input.passportPhotoMimeType ?? null,
          proofOfTenureDataUrl: input.proofOfTenureDataUrl ?? null,
          proofOfTenureName: input.proofOfTenureName ?? null,
          proofOfTenureMimeType: input.proofOfTenureMimeType ?? null,
          submittedAt,
        })
        .returning({
          id: membershipApplicationsTable.id,
          reference: membershipApplicationsTable.reference,
          status: membershipApplicationsTable.status,
          submittedAt: membershipApplicationsTable.submittedAt,
          subscriptionVote: membershipApplicationsTable.subscriptionVote,
        });

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "membership.application.submitted",
        recordType: "membership_application",
        recordId: application.id,
        metadata: JSON.stringify({
          status: application.status,
          membershipCategory: input.membershipCategory,
          subscriptionVote: input.subscriptionVote,
        }),
      });
      return application;
    });

    res
      .status(201)
      .json(SubmitResidentApplicationResponse.parse(created));
    void pushToGoogleSheets({
      kind: "registration",
      reference: created.reference,
      submittedAt: created.submittedAt.toISOString(),
      fields: {
        fullName: input.fullName.trim(),
        nrcNumber,
        passportNumber,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        nationality: input.nationality.trim(),
        phone: input.phone.trim(),
        phoneAlt: input.phoneAlt?.trim() || "",
        email: input.email?.trim() || "",
        houseNumber: input.houseNumber.trim(),
        streetOrZone: input.streetOrZone.trim(),
        plotNumber: input.plotNumber?.trim() || "",
        livesInSalamaPark: input.livesInSalamaPark,
        residencyStatus: input.residencyStatus,
        residencySince: input.residencySince.trim(),
        ownsProperty: input.ownsProperty,
        propertyPlots: input.propertyPlots?.trim() || "",
        wardRegisteredVoter: input.wardRegisteredVoter ?? "",
        membershipCategory: input.membershipCategory,
        otherAssociationMember: input.otherAssociationMember ?? "",
        otherAssociationName: input.otherAssociationName?.trim() || "",
        subscriptionVote: input.subscriptionVote,
        agreeToPayAdopted: input.agreeToPayAdopted,
        reliefOption: input.reliefOption,
        paymentMethod: input.paymentMethod ?? "",
        signatureName: input.signatureName.trim(),
        principalResidenceAddress:
          input.principalResidenceAddress?.trim() || "",
        associationBasis: input.associationBasis?.trim() || "",
        nominatedBy: input.nominatedBy?.trim() || "",
        occupation: input.occupation?.trim() || "",
        willingToVolunteer: input.willingToVolunteer ?? false,
        volunteerSkills: input.volunteerSkills?.trim() || "",
        accessNeeds: input.accessNeeds?.trim() || "",
        preferredLanguage: input.preferredLanguage ?? "",
        adultsInHousehold: input.adultsInHousehold ?? "",
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelationship,
        status: created.status,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: "An application already exists for this account. Check its status from your resident dashboard.",
      });
      return;
    }
    throw error;
  }
});

router.post("/resident/petition", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const parsed = SubmitPetitionConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Confirm each declaration and complete every required field before submitting.",
    });
    return;
  }
  const declarationsConfirmed = DECLARATION_KEYS.every(
    (key) => parsed.data[key] === true,
  );
  if (!declarationsConfirmed) {
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
    const result = await db.transaction(async (tx: any) => {
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
          declarations: JSON.stringify(
            Object.fromEntries(
              DECLARATION_KEYS.map((key) => [key, parsed.data[key]]),
            ),
          ),
          status: "accepted",
          submittedAt,
        })
        .returning({
          reference: petitionSubmissionsTable.reference,
          submittedAt: petitionSubmissionsTable.submittedAt,
          constitutionVersion: petitionSubmissionsTable.constitutionVersion,
          petitionVersion: petitionSubmissionsTable.petitionVersion,
          status: petitionSubmissionsTable.status,
          subscriptionVote: petitionSubmissionsTable.subscriptionVote,
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
    void pushToGoogleSheets({
      kind: "petition",
      reference: result.reference,
      submittedAt: result.submittedAt.toISOString(),
      fields: {
        constitutionVersion: result.constitutionVersion,
        petitionVersion: result.petitionVersion,
        status: result.status,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: "An active signature has already been recorded for this petition.",
      });
      return;
    }
    throw error;
  }
});

router.get("/resident/petition/receipts", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const receipts = await db
    .select({
      reference: petitionSubmissionsTable.reference,
      submittedAt: petitionSubmissionsTable.submittedAt,
      constitutionVersion: petitionSubmissionsTable.constitutionVersion,
      petitionVersion: petitionSubmissionsTable.petitionVersion,
      status: petitionSubmissionsTable.status,
      subscriptionVote: petitionSubmissionsTable.subscriptionVote,
    })
    .from(petitionSubmissionsTable)
    .where(eq(petitionSubmissionsTable.userId, userId))
    .orderBy(desc(petitionSubmissionsTable.submittedAt));

  res.json(GetMyPetitionReceiptsResponse.parse(receipts));
});

router.post("/resident/petition/withdraw", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
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
  const result = await db.transaction(async (tx: any) => {
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
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const roles = await getAssociationRoles(userId);
  const role = adminRoles.find((candidate) => roles.includes(candidate)) ?? null;
  res.json(
    GetAdminAccessResponse.parse({
      allowed: role !== null,
      role,
    }),
  );
});

router.get("/admin/dashboard", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...adminRoles)) {
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
  const counts = new Map(applicationCounts.map((item: any) => [item.status, item.value]));

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
  let rejectedPetitionSignatures = 0;
  let disputedPetitionSignatures = 0;
  let withdrawnPetitionSignatures = 0;
  if (config) {
    const statuses = ["accepted", "rejected", "disputed", "withdrawn"] as const;
    for (const status of statuses) {
      const [row] = await db
        .select({ value: count() })
        .from(petitionSubmissionsTable)
        .where(
          and(
            eq(petitionSubmissionsTable.petitionConfigurationId, config.id),
            eq(petitionSubmissionsTable.status, status),
          ),
        );
      if (status === "accepted") acceptedPetitionSignatures = row?.value ?? 0;
      if (status === "rejected") rejectedPetitionSignatures = row?.value ?? 0;
      if (status === "disputed") disputedPetitionSignatures = row?.value ?? 0;
      if (status === "withdrawn") withdrawnPetitionSignatures = row?.value ?? 0;
    }
  }

  const denominator = snapshot?.denominator ?? null;
  const proposedThreshold = config?.proposedThreshold ?? null;
  // As on the public overview, the constitutional two-thirds rule decides
  // whether the threshold is reached; the proposed number is informational.
  const thresholds = calculatePetitionThresholds(
    denominator,
    acceptedPetitionSignatures,
  );

  const poll = await computePollMetrics();
  const [unverifiedRow] = await db
    .select({ value: count() })
    .from(petitionSubmissionsTable)
    .where(
      and(
        eq(petitionSubmissionsTable.status, "accepted"),
        isNull(petitionSubmissionsTable.verifiedAt),
      ),
    );
  const [duplicateRow] = await db
    .select({ value: count() })
    .from(petitionSubmissionsTable)
    .where(eq(petitionSubmissionsTable.duplicateFlag, true));

  res.json(
    GetAdminDashboardResponse.parse({
      totalApplications: totalApplications?.value ?? 0,
      pendingApplications: counts.get("pending-verification") ?? 0,
      clarificationRequested: counts.get("clarification-requested") ?? 0,
      verifiedApplications: counts.get("verified") ?? 0,
      rejectedApplications: counts.get("rejected") ?? 0,
      acceptedPetitionSignatures,
      verifiedDenominator: denominator,
      petitionStatus: config ? getPetitionState(config) : "not-configured",
      twoThirdsThreshold: thresholds.twoThirdsThreshold,
      minimumQuorum: thresholds.minimumQuorum,
      signaturesRemaining: thresholds.signaturesRemaining,
      thresholdReached: thresholds.thresholdReached,
      totalVotes: poll.totalVotes,
      votesK50: poll.votesK50,
      votesK100: poll.votesK100,
      votesK150: poll.votesK150,
      currentWinner: poll.currentWinner,
      homeowners: poll.homeowners,
      tenants: poll.tenants,
      volunteers: poll.volunteers,
      onlineVotingConsent: poll.onlineVotingConsent,
      unverifiedSignatures: unverifiedRow?.value ?? 0,
      duplicateFlags: duplicateRow?.value ?? 0,
    }),
  );
});

router.get("/admin/applications", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...adminRoles)) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }
  const query = GetAdminApplicationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Check the application search and filters." });
    return;
  }

  const filters: any[] = [];
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
        ilike(membershipApplicationsTable.nrcNumber, term),
        ilike(membershipApplicationsTable.phone, term),
        ilike(membershipApplicationsTable.membershipNumber, term),
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
      nrcNumber: membershipApplicationsTable.nrcNumber,
      passportNumber: membershipApplicationsTable.passportNumber,
      dateOfBirth: membershipApplicationsTable.dateOfBirth,
      gender: membershipApplicationsTable.gender,
      nationality: membershipApplicationsTable.nationality,
      residencyStatus: membershipApplicationsTable.residencyStatus,
      residencySince: membershipApplicationsTable.residencySince,
      ownsProperty: membershipApplicationsTable.ownsProperty,
      membershipCategory: membershipApplicationsTable.membershipCategory,
      subscriptionVote: membershipApplicationsTable.subscriptionVote,
      membershipNumber: membershipApplicationsTable.membershipNumber,
      admittedAt: membershipApplicationsTable.admittedAt,
      receivedBy: membershipApplicationsTable.receivedBy,
      verifiedAgainstNrc: membershipApplicationsTable.verifiedAgainstNrc,
      rejectionCategory: membershipApplicationsTable.rejectionCategory,
      verificationNotes: membershipApplicationsTable.verificationNotes,
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
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...reviewerRoles)) {
    res.status(403).json({ error: "Returning Officer or administrator access is required." });
    return;
  }

  const params = ReviewMembershipApplicationParams.safeParse(req.params);
  const body = ReviewMembershipApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid decision and a reason for the record." });
    return;
  }

  if (body.data.status === "rejected" && !body.data.rejectionCategory) {
    res.status(400).json({
      error:
        "Choose a rejection category: duplicate, not a resident, or incomplete declaration.",
    });
    return;
  }

  const reviewedAt = new Date();
  const result = await db.transaction(async (tx: any) => {
    const [existing] = await tx
      .select({
        status: membershipApplicationsTable.status,
        membershipNumber: membershipApplicationsTable.membershipNumber,
        admittedAt: membershipApplicationsTable.admittedAt,
      })
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, params.data.id))
      .limit(1);
    if (!existing) return null;

    // Verified and rejected are final. A decision is only recorded while an
    // application is still awaiting one, unless the officer deliberately sets
    // override, which replaces the recorded decision as a correction.
    const finalStatuses = ["verified", "rejected"];
    const overriding = body.data.override === true;
    if (finalStatuses.includes(existing.status) && !overriding) {
      return { alreadyDecided: true as const, status: existing.status };
    }
    const previousStatus = finalStatuses.includes(existing.status)
      ? existing.status
      : null;

    let membershipNumber = existing.membershipNumber;
    if (body.data.status === "verified" && !membershipNumber) {
      const [verifiedCount] = await tx
        .select({ value: count() })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.status, "verified"));
      membershipNumber = `MEM-${String((verifiedCount?.value ?? 0) + 1).padStart(4, "0")}`;
    }

    const update: Record<string, unknown> = {
      status: body.data.status,
      decisionReason: body.data.reason.trim(),
      receivedBy: body.data.receivedBy?.trim() || null,
      verifiedAgainstNrc: body.data.verifiedAgainstNrc ?? null,
      rejectionCategory:
        body.data.status === "rejected"
          ? body.data.rejectionCategory ?? null
          : null,
      verificationNotes: body.data.verificationNotes?.trim() || null,
      reviewedBy: userId,
      reviewedAt,
      updatedAt: reviewedAt,
    };
    if (body.data.status === "verified") {
      update.membershipNumber = membershipNumber;
      update.admittedAt = existing.admittedAt ?? reviewedAt;
    } else if (previousStatus === "verified") {
      // A verified member corrected to another outcome gives up the admission
      // number and admission date; otherwise they would keep a member number
      // while no longer holding a verified membership.
      update.membershipNumber = null;
      update.admittedAt = null;
    }

    const [application] = await tx
      .update(membershipApplicationsTable)
      .set(update)
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
        nrcNumber: membershipApplicationsTable.nrcNumber,
        passportNumber: membershipApplicationsTable.passportNumber,
        dateOfBirth: membershipApplicationsTable.dateOfBirth,
        gender: membershipApplicationsTable.gender,
        nationality: membershipApplicationsTable.nationality,
        residencyStatus: membershipApplicationsTable.residencyStatus,
        residencySince: membershipApplicationsTable.residencySince,
        ownsProperty: membershipApplicationsTable.ownsProperty,
        membershipCategory: membershipApplicationsTable.membershipCategory,
        subscriptionVote: membershipApplicationsTable.subscriptionVote,
        membershipNumber: membershipApplicationsTable.membershipNumber,
        admittedAt: membershipApplicationsTable.admittedAt,
        receivedBy: membershipApplicationsTable.receivedBy,
        verifiedAgainstNrc: membershipApplicationsTable.verifiedAgainstNrc,
        rejectionCategory: membershipApplicationsTable.rejectionCategory,
        verificationNotes: membershipApplicationsTable.verificationNotes,
      });
    if (!application) return null;

    await tx.insert(auditLogsTable).values({
      actorUserId: userId,
      action: previousStatus
        ? "membership.application.decision-changed"
        : "membership.application.reviewed",
      recordType: "membership_application",
      recordId: application.id,
      metadata: JSON.stringify({
        status: application.status,
        previousStatus,
        reason: body.data.reason.trim(),
        rejectionCategory: application.rejectionCategory,
        receivedBy: application.receivedBy,
        verifiedAgainstNrc: application.verifiedAgainstNrc,
        membershipNumber: application.membershipNumber,
      }),
    });
    return application;
  });
  if (!result) {
    res.status(404).json({ error: "Membership application not found." });
    return;
  }
  if (typeof result === "object" && "alreadyDecided" in result) {
    res.status(409).json({
      error: `This application has already been ${result.status}. To replace that decision deliberately, use Change decision.`,
    });
    return;
  }
  res.json(ReviewMembershipApplicationResponse.parse(result));
});

router.get(
  "/admin/petition/submissions",
  async (req, res): Promise<void> => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const roles = await getAssociationRoles(userId);
    if (!hasRole(roles, ...adminRoles)) {
      res
        .status(403)
        .json({ error: "An authorized association role is required." });
      return;
    }
    const query = GetAdminPetitionSubmissionsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Check the submission search and filters." });
      return;
    }

    const filters: any[] = [];
    if (query.data.status) {
      filters.push(eq(petitionSubmissionsTable.status, query.data.status));
    }
    if (query.data.search?.trim()) {
      const term = `%${query.data.search.trim()}%`;
      filters.push(
        or(
          ilike(membershipApplicationsTable.fullName, term),
          ilike(petitionSubmissionsTable.reference, term),
          ilike(membershipApplicationsTable.houseNumber, term),
          ilike(membershipApplicationsTable.streetOrZone, term),
          ilike(membershipApplicationsTable.phone, term),
        ),
      );
    }
    const where = filters.length ? and(...filters) : undefined;
    const join = eq(
      petitionSubmissionsTable.userId,
      membershipApplicationsTable.userId,
    );

    const [total] = await db
      .select({ value: count() })
      .from(petitionSubmissionsTable)
      .leftJoin(membershipApplicationsTable, join)
      .where(where);

    const rows = await db
      .select({
        id: petitionSubmissionsTable.id,
        reference: petitionSubmissionsTable.reference,
        userId: petitionSubmissionsTable.userId,
        fullName: membershipApplicationsTable.fullName,
        houseNumber: membershipApplicationsTable.houseNumber,
        streetOrZone: membershipApplicationsTable.streetOrZone,
        phone: membershipApplicationsTable.phone,
        status: petitionSubmissionsTable.status,
        onMembersRegister: petitionSubmissionsTable.onMembersRegister,
        duplicateFlag: petitionSubmissionsTable.duplicateFlag,
        verifiedBy: petitionSubmissionsTable.verifiedBy,
        verifiedAt: petitionSubmissionsTable.verifiedAt,
        verificationNotes: petitionSubmissionsTable.verificationNotes,
        submittedAt: petitionSubmissionsTable.submittedAt,
      })
      .from(petitionSubmissionsTable)
      .leftJoin(membershipApplicationsTable, join)
      .where(where)
      .orderBy(desc(petitionSubmissionsTable.submittedAt))
      .limit(query.data.pageSize)
      .offset((query.data.page - 1) * query.data.pageSize);

    const items = rows.map((row: any) => ({
      ...row,
      fullName: row.fullName ?? "Unknown resident",
      houseNumber: row.houseNumber ?? "",
      streetOrZone: row.streetOrZone ?? "",
      phone: row.phone ?? "",
    }));

    res.json(
      GetAdminPetitionSubmissionsResponse.parse({
        items,
        page: query.data.page,
        pageSize: query.data.pageSize,
        total: total?.value ?? 0,
      }),
    );
  },
);

router.post(
  "/admin/petition/submissions/:id/verify",
  async (req, res): Promise<void> => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const roles = await getAssociationRoles(userId);
    if (!hasRole(roles, ...reviewerRoles)) {
      res
        .status(403)
        .json({ error: "Returning Officer or administrator access is required." });
      return;
    }

    const params = VerifyPetitionSubmissionParams.safeParse(req.params);
    const body = VerifyPetitionSubmissionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: "Provide a valid verification decision and a reason for the record.",
      });
      return;
    }

    const verifiedAt = new Date();
    const result = await db.transaction(async (tx: any) => {
      const [submission] = await tx
        .update(petitionSubmissionsTable)
        .set({
          status: body.data.status,
          onMembersRegister: body.data.onMembersRegister,
          duplicateFlag: body.data.duplicateFlag,
          verifiedBy: userId,
          verifiedAt,
          verificationNotes: body.data.reason.trim(),
        })
        .where(eq(petitionSubmissionsTable.id, params.data.id))
        .returning({
          id: petitionSubmissionsTable.id,
          reference: petitionSubmissionsTable.reference,
          userId: petitionSubmissionsTable.userId,
          status: petitionSubmissionsTable.status,
          onMembersRegister: petitionSubmissionsTable.onMembersRegister,
          duplicateFlag: petitionSubmissionsTable.duplicateFlag,
          verifiedBy: petitionSubmissionsTable.verifiedBy,
          verifiedAt: petitionSubmissionsTable.verifiedAt,
          verificationNotes: petitionSubmissionsTable.verificationNotes,
          submittedAt: petitionSubmissionsTable.submittedAt,
        });
      if (!submission) return null;

      const [application] = await tx
        .select({
          fullName: membershipApplicationsTable.fullName,
          houseNumber: membershipApplicationsTable.houseNumber,
          streetOrZone: membershipApplicationsTable.streetOrZone,
          phone: membershipApplicationsTable.phone,
        })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.userId, submission.userId))
        .limit(1);

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "petition.signature.verified",
        recordType: "petition_submission",
        recordId: submission.reference,
        metadata: JSON.stringify({
          status: submission.status,
          onMembersRegister: submission.onMembersRegister,
          duplicateFlag: submission.duplicateFlag,
          reason: body.data.reason.trim(),
        }),
      });

      return {
        ...submission,
        fullName: application?.fullName ?? "Unknown resident",
        houseNumber: application?.houseNumber ?? "",
        streetOrZone: application?.streetOrZone ?? "",
        phone: application?.phone ?? "",
      };
    });
    if (!result) {
      res.status(404).json({ error: "Petition submission not found." });
      return;
    }
    res.json(VerifyPetitionSubmissionResponse.parse(result));
  },
);

/**
 * Register snapshots fix the verified denominator that the constitutional
 * two-thirds threshold is measured against. Publishing one is an officer
 * action: it is append-only, and the newest snapshot by approved_at is the one
 * the public pages use.
 */
router.get("/admin/register-snapshots", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...adminRoles)) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }

  const snapshots = await db
    .select()
    .from(registerSnapshotsTable)
    .orderBy(desc(registerSnapshotsTable.approvedAt));

  res.json(GetAdminRegisterSnapshotsResponse.parse(snapshots));
});

router.post("/admin/register-snapshots", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...adminRoles)) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }

  const parsed = CreateAdminRegisterSnapshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Provide a reference, a positive denominator, a cutoff date, the rules used, and an integrity hash.",
    });
    return;
  }
  const input = parsed.data;

  try {
    const created = await db.transaction(async (tx: any) => {
      const [snapshot] = await tx
        .insert(registerSnapshotsTable)
        .values({
          reference: input.reference.trim(),
          denominator: input.denominator,
          cutoffAt: input.cutoffAt,
          rulesDescription: input.rulesDescription.trim(),
          integrityHash: input.integrityHash.trim(),
          approvedBy: userId,
          approvedAt: new Date(),
        })
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "register.snapshot.published",
        recordType: "register_snapshot",
        recordId: snapshot.reference,
        metadata: JSON.stringify({
          denominator: snapshot.denominator,
          cutoffAt: snapshot.cutoffAt,
          integrityHash: snapshot.integrityHash,
        }),
      });

      return snapshot;
    });

    res.status(201).json(CreateAdminRegisterSnapshotResponse.parse(created));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: "A register snapshot with that reference already exists.",
      });
      return;
    }
    throw error;
  }
});

type PetitionConfigRow = {
  id: string;
  title: string;
  petitionVersion: string;
  constitutionVersion: string;
  eligibilityText: string;
  openingAt: Date | null;
  closingAt: Date | null;
  registerSnapshotId: string | null;
  proposedThreshold: number | null;
  status: "draft" | "approved" | "closed";
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
};

function describePetitionConfiguration(config: PetitionConfigRow | null) {
  const state = config ? getPetitionState(config) : ("not-configured" as const);
  return { configuration: config, state, signingEnabled: state === "open" };
}

async function loadCurrentPetitionConfiguration() {
  const [config] = await db
    .select()
    .from(petitionConfigurationsTable)
    .orderBy(desc(petitionConfigurationsTable.createdAt))
    .limit(1);
  return (config ?? null) as PetitionConfigRow | null;
}

router.get("/admin/petition/configuration", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...adminRoles)) {
    res.status(403).json({ error: "An authorized association role is required." });
    return;
  }

  const config = await loadCurrentPetitionConfiguration();
  res.json(
    GetAdminPetitionConfigurationResponse.parse(
      describePetitionConfiguration(config),
    ),
  );
});

/**
 * Save (or replace) the draft configuration. Only one configuration is ever in
 * play, so a new save supersedes the previous one: the old row is kept for the
 * audit trail but moved to "closed" so residents can no longer sign against it.
 */
router.post(
  "/admin/petition/configuration/save",
  async (req, res): Promise<void> => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const roles = await getAssociationRoles(userId);
    if (!hasRole(roles, ...adminRoles)) {
      res.status(403).json({
        error: "An authorized association role is required.",
      });
      return;
    }

    const parsed = SaveAdminPetitionConfigurationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Provide the title, petition and Constitution versions, eligibility text, an opening date and a closing date.",
      });
      return;
    }
    const input = parsed.data;

    if (input.closingAt <= input.openingAt) {
      res.status(400).json({
        error: "The closing date must be after the opening date.",
      });
      return;
    }

    if (input.registerSnapshotId) {
      const [snapshot] = await db
        .select({ id: registerSnapshotsTable.id })
        .from(registerSnapshotsTable)
        .where(eq(registerSnapshotsTable.id, input.registerSnapshotId))
        .limit(1);
      if (!snapshot) {
        res.status(400).json({
          error: "The selected register snapshot does not exist.",
        });
        return;
      }
    }

    const saved = await db.transaction(async (tx: any) => {
      const [previous] = await tx
        .select({ id: petitionConfigurationsTable.id })
        .from(petitionConfigurationsTable)
        .where(eq(petitionConfigurationsTable.status, "approved"))
        .orderBy(desc(petitionConfigurationsTable.createdAt))
        .limit(1);
      if (previous) {
        await tx
          .update(petitionConfigurationsTable)
          .set({ status: "closed" })
          .where(eq(petitionConfigurationsTable.id, previous.id));
      }

      const [created] = await tx
        .insert(petitionConfigurationsTable)
        .values({
          title: input.title.trim(),
          petitionVersion: input.petitionVersion.trim(),
          constitutionVersion: input.constitutionVersion.trim(),
          eligibilityText: input.eligibilityText.trim(),
          openingAt: input.openingAt,
          closingAt: input.closingAt,
          registerSnapshotId: input.registerSnapshotId ?? null,
          proposedThreshold: input.proposedThreshold ?? null,
          status: "draft",
        })
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "petition.configuration.saved",
        recordType: "petition_configuration",
        recordId: created.id,
        metadata: JSON.stringify({
          petitionVersion: created.petitionVersion,
          constitutionVersion: created.constitutionVersion,
          openingAt: created.openingAt,
          closingAt: created.closingAt,
          registerSnapshotId: created.registerSnapshotId,
          supersededConfigurationId: previous?.id ?? null,
        }),
      });

      return created;
    });

    res.json(
      SaveAdminPetitionConfigurationResponse.parse(
        describePetitionConfiguration(saved as PetitionConfigRow),
      ),
    );
  },
);

router.post(
  "/admin/petition/configuration/approve",
  async (req, res): Promise<void> => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const roles = await getAssociationRoles(userId);
    if (!hasRole(roles, ...reviewerRoles)) {
      res.status(403).json({
        error: "Returning Officer or administrator role required.",
      });
      return;
    }

    const config = await loadCurrentPetitionConfiguration();
    if (!config) {
      res.status(404).json({ error: "No petition configuration exists to approve." });
      return;
    }
    if (config.status !== "draft") {
      res.status(400).json({
        error: "Only a draft configuration can be approved.",
      });
      return;
    }
    if (!config.openingAt || !config.closingAt) {
      res.status(400).json({
        error: "Set the opening and closing dates before approving.",
      });
      return;
    }

    const approved = await db.transaction(async (tx: any) => {
      const [updated] = await tx
        .update(petitionConfigurationsTable)
        .set({ status: "approved", approvedBy: userId, approvedAt: new Date() })
        .where(eq(petitionConfigurationsTable.id, config.id))
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "petition.configuration.approved",
        recordType: "petition_configuration",
        recordId: updated.id,
        metadata: JSON.stringify({
          petitionVersion: updated.petitionVersion,
          constitutionVersion: updated.constitutionVersion,
          openingAt: updated.openingAt,
          closingAt: updated.closingAt,
        }),
      });

      return updated;
    });

    res.json(
      ApproveAdminPetitionConfigurationResponse.parse(
        describePetitionConfiguration(approved as PetitionConfigRow),
      ),
    );
  },
);

router.post(
  "/admin/petition/configuration/close",
  async (req, res): Promise<void> => {
    const userId = await requireUserId(req, res);
    if (!userId) return;
    const roles = await getAssociationRoles(userId);
    if (!hasRole(roles, ...reviewerRoles)) {
      res.status(403).json({
        error: "Returning Officer or administrator role required.",
      });
      return;
    }

    const config = await loadCurrentPetitionConfiguration();
    if (!config) {
      res.status(404).json({ error: "No petition configuration exists to close." });
      return;
    }

    const closed = await db.transaction(async (tx: any) => {
      const [updated] = await tx
        .update(petitionConfigurationsTable)
        .set({ status: "closed" })
        .where(eq(petitionConfigurationsTable.id, config.id))
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "petition.configuration.closed",
        recordType: "petition_configuration",
        recordId: updated.id,
        metadata: JSON.stringify({
          petitionVersion: updated.petitionVersion,
          constitutionVersion: updated.constitutionVersion,
        }),
      });

      return updated;
    });

    res.json(
      CloseAdminPetitionConfigurationResponse.parse(
        describePetitionConfiguration(closed as PetitionConfigRow),
      ),
    );
  },
);

/**
 * Role administration.
 *
 * Access to privileged workflows is decided by the roles held in
 * user_roles, with BOOTSTRAP_ADMIN_USER_ID(S) and Clerk publicMetadata as
 * fallbacks for accounts provisioned before the role register existed. Only an
 * administrator may change roles, and an administrator cannot take their own
 * administrator role away, so the association can never lock itself out.
 */
const grantableRoles = [
  "resident",
  "returning-officer",
  "scrutineer",
  "treasurer",
  "administrator",
] as const;

type GrantableRole = (typeof grantableRoles)[number];

async function requireAdministrator(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = await requireUserId(req, res);
  if (!userId) return null;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, "administrator", "admin")) {
    res.status(403).json({
      error: "An association administrator role is required.",
    });
    return null;
  }
  return userId;
}

/** Active role assignments for one account. Accepts a transaction client so it
 * observes rows written earlier in the same transaction. */
async function activeRolesFor(
  client: any,
  userId: string,
): Promise<string[]> {
  const rows = await client
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(
      and(eq(userRolesTable.userId, userId), isNull(userRolesTable.revokedAt)),
    );
  return rows.map((row: any) => row.role);
}

router.get("/admin/roles", async (req, res): Promise<void> => {
  const adminId = await requireAdministrator(req, res);
  if (!adminId) return;

  const rows = await db
    .select({
      userId: userRolesTable.userId,
      role: userRolesTable.role,
      assignedBy: userRolesTable.assignedBy,
      assignedAt: userRolesTable.assignedAt,
    })
    .from(userRolesTable)
    .where(isNull(userRolesTable.revokedAt))
    .orderBy(desc(userRolesTable.assignedAt));

  res.json(GetAdminRolesResponse.parse({ items: rows }));
});

router.post("/admin/roles/grant", async (req, res): Promise<void> => {
  const adminId = await requireAdministrator(req, res);
  if (!adminId) return;

  const parsed = GrantAdminRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Provide the account to grant and a valid association role.",
    });
    return;
  }
  const targetUserId = parsed.data.userId.trim();
  const role = parsed.data.role as GrantableRole;

  const roles = await db.transaction(async (tx: any) => {
    // The role register references profiles, so make sure the account has one
    // even if it has never registered or signed anything.
    await tx
      .insert(profilesTable)
      .values({ id: targetUserId })
      .onConflictDoNothing();

    const existing = await tx
      .select({ id: userRolesTable.id })
      .from(userRolesTable)
      .where(
        and(
          eq(userRolesTable.userId, targetUserId),
          eq(userRolesTable.role, role),
          isNull(userRolesTable.revokedAt),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await tx.insert(userRolesTable).values({
        userId: targetUserId,
        role,
        assignedBy: adminId,
      });

      await tx.insert(auditLogsTable).values({
        actorUserId: adminId,
        action: "association.role.granted",
        recordType: "user_role",
        recordId: targetUserId,
        metadata: JSON.stringify({ role, targetUserId }),
      });
    }

    return activeRolesFor(tx, targetUserId);
  });

  res.json(
    GrantAdminRoleResponse.parse({ userId: targetUserId, roles }),
  );
});

router.post("/admin/roles/revoke", async (req, res): Promise<void> => {
  const adminId = await requireAdministrator(req, res);
  if (!adminId) return;

  const parsed = RevokeAdminRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Provide the account to revoke and a valid association role.",
    });
    return;
  }
  const targetUserId = parsed.data.userId.trim();
  const role = parsed.data.role as GrantableRole;

  if (targetUserId === adminId && role === "administrator") {
    res.status(400).json({
      error: "You cannot remove your own administrator role.",
    });
    return;
  }

  const roles = await db.transaction(async (tx: any) => {
    await tx
      .update(userRolesTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userRolesTable.userId, targetUserId),
          eq(userRolesTable.role, role),
          isNull(userRolesTable.revokedAt),
        ),
      );

    await tx.insert(auditLogsTable).values({
      actorUserId: adminId,
      action: "association.role.revoked",
      recordType: "user_role",
      recordId: targetUserId,
      metadata: JSON.stringify({ role, targetUserId }),
    });

    return activeRolesFor(tx, targetUserId);
  });

  res.json(
    RevokeAdminRoleResponse.parse({ userId: targetUserId, roles }),
  );
});

/* -------------------------------------------------------------------------- *
 * Finance — subscriptions, payments and expenses.
 *
 * Money is handled in minor units (ngwee) throughout. The API speaks ngwee and
 * the UI formats as Kwacha, so no rounding decision ever happens at the edge.
 * -------------------------------------------------------------------------- */

/** Mirror of requireAdministrator, but for the narrower finance permission. */
async function requireFinanceUser(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = await requireUserId(req, res);
  if (!userId) return null;
  const roles = await getAssociationRoles(userId);
  if (!hasRole(roles, ...financeRoles)) {
    res.status(403).json({
      error: "An administrator or treasurer role is required for finance.",
    });
    return null;
  }
  return userId;
}

/**
 * The amount a member was polled at, mapped to the period's tier amounts.
 * A member who did not answer the poll is charged the standard tier, since
 * some subscription is expected from every adult member.
 */
function tierAmountForVote(
  vote: string | null,
  period: {
    amountTierLow: number;
    amountTierStandard: number;
    amountTierHigh: number;
  },
): number {
  switch (vote) {
    case "k50":
      return period.amountTierLow;
    case "k150":
      return period.amountTierHigh;
    default:
      return period.amountTierStandard;
  }
}

/**
 * Recompute a charge's status from the money actually recorded against it.
 * Waived is only reached once the waived amount and the paid amount together
 * cover the amount due, so a partial waiver leaves the member still owing.
 */
function chargeStatus(
  amountDue: number,
  amountPaid: number,
  amountWaived: number,
): "outstanding" | "part-paid" | "paid" | "waived" {
  const settled = amountPaid + amountWaived;
  if (settled >= amountDue) {
    // If nothing was paid and it is fully covered, it was a pure waiver.
    return amountPaid === 0 && amountWaived > 0 ? "waived" : "paid";
  }
  if (amountPaid > 0 || amountWaived > 0) return "part-paid";
  return "outstanding";
}

/** Shape a charge row plus its joined member details into the API response. */
function toAdminCharge(row: {
  charge: typeof financeChargesTable.$inferSelect;
  periodYear: number | null;
  houseNumber: string | null;
  streetOrZone: string | null;
  email: string | null;
  phone: string | null;
}): Record<string, unknown> {
  const { charge } = row;
  return {
    id: charge.id,
    periodId: charge.periodId,
    periodYear: row.periodYear,
    applicationId: charge.applicationId,
    membershipNumber: charge.membershipNumber,
    memberName: charge.memberName,
    houseNumber: row.houseNumber,
    streetOrZone: row.streetOrZone,
    email: row.email,
    phone: row.phone,
    amountDue: charge.amountDue,
    amountPaid: charge.amountPaid,
    amountWaived: charge.amountWaived,
    balance: Math.max(
      0,
      charge.amountDue - charge.amountPaid - charge.amountWaived,
    ),
    status: charge.status,
    dueDate: charge.dueDate,
    waivedReason: charge.waivedReason,
    reminderCount: charge.reminderCount,
    lastReminderAt: charge.lastReminderAt,
  };
}

/** A trimmed, non-empty string, or null. Keeps empty form fields out of the DB. */
function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

router.get(
  "/admin/finance/periods",
  async (req, res): Promise<void> => {
    if (!(await requireFinanceUser(req, res))) return;

    const rows = await db
      .select()
      .from(financePeriodsTable)
      .orderBy(desc(financePeriodsTable.year));

    // Attach billed and collected totals so the list is useful on its own.
    const totals = await db
      .select({
        periodId: financeChargesTable.periodId,
        chargeCount: count(),
        amountBilled: sql<number>`coalesce(sum(${financeChargesTable.amountDue}), 0)::int`,
        amountCollected: sql<number>`coalesce(sum(${financeChargesTable.amountPaid}), 0)::int`,
      })
      .from(financeChargesTable)
      .groupBy(financeChargesTable.periodId);

    const byPeriod = new Map(totals.map((row) => [row.periodId, row]));

    res.json(
      GetAdminFinancePeriodsResponse.parse(
        rows.map((row) => {
          const total = byPeriod.get(row.id);
          return {
            id: row.id,
            year: row.year,
            currency: row.currency,
            label: row.label,
            amountTierLow: row.amountTierLow,
            amountTierStandard: row.amountTierStandard,
            amountTierHigh: row.amountTierHigh,
            status: row.status,
            notes: row.notes,
            createdAt: row.createdAt,
            chargeCount: total?.chargeCount ?? 0,
            amountBilled: total?.amountBilled ?? 0,
            amountCollected: total?.amountCollected ?? 0,
          };
        }),
      ),
    );
  },
);

router.post(
  "/admin/finance/periods",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const parsed = CreateAdminFinancePeriodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Provide a year between 2000 and 2200, and the three subscription tier amounts.",
      });
      return;
    }
    const body = parsed.data;

    const existing = await db
      .select({ id: financePeriodsTable.id })
      .from(financePeriodsTable)
      .where(eq(financePeriodsTable.year, body.year))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({
        error: `A subscription period already exists for ${body.year}.`,
      });
      return;
    }

    const [created] = await db
      .insert(financePeriodsTable)
      .values({
        year: body.year,
        currency: optionalText(body.currency) ?? "ZMW",
        label: optionalText(body.label),
        amountTierLow: body.amountTierLow,
        amountTierStandard: body.amountTierStandard,
        amountTierHigh: body.amountTierHigh,
        notes: optionalText(body.notes),
        createdByUserId: userId,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "finance.period.created",
      recordType: "finance_period",
      recordId: created.id,
      metadata: JSON.stringify({
        year: created.year,
        amountTierLow: created.amountTierLow,
        amountTierStandard: created.amountTierStandard,
        amountTierHigh: created.amountTierHigh,
      }),
    });

    res.json(
      CreateAdminFinancePeriodResponse.parse({
        id: created.id,
        year: created.year,
        currency: created.currency,
        label: created.label,
        amountTierLow: created.amountTierLow,
        amountTierStandard: created.amountTierStandard,
        amountTierHigh: created.amountTierHigh,
        status: created.status,
        notes: created.notes,
        createdAt: created.createdAt,
        chargeCount: 0,
        amountBilled: 0,
        amountCollected: 0,
      }),
    );
  },
);

router.post(
  "/admin/finance/periods/:id/generate",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const params = GenerateAdminFinanceChargesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid subscription period id." });
      return;
    }

    const [period] = await db
      .select()
      .from(financePeriodsTable)
      .where(eq(financePeriodsTable.id, params.data.id))
      .limit(1);
    if (!period) {
      res.status(404).json({ error: "Subscription period not found." });
      return;
    }
    if (period.status === "closed") {
      res.status(400).json({
        error: "This period is closed. Raise charges in an open period.",
      });
      return;
    }

    // Only verified members are billed. Pending applications have no membership
    // number and may still be rejected, so charging them would be premature.
    const verified = await db
      .select({
        id: membershipApplicationsTable.id,
        fullName: membershipApplicationsTable.fullName,
        membershipNumber: membershipApplicationsTable.membershipNumber,
        subscriptionVote: membershipApplicationsTable.subscriptionVote,
      })
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.status, "verified"));

    const existing = await db
      .select({ applicationId: financeChargesTable.applicationId })
      .from(financeChargesTable)
      .where(eq(financeChargesTable.periodId, period.id));
    const alreadyCharged = new Set(existing.map((row) => row.applicationId));

    const toCreate = verified
      .filter((member) => !alreadyCharged.has(member.id))
      .map((member) => ({
        periodId: period.id,
        applicationId: member.id,
        membershipNumber: member.membershipNumber,
        memberName: member.fullName,
        amountDue: tierAmountForVote(member.subscriptionVote, period),
      }));

    if (toCreate.length > 0) {
      await db.insert(financeChargesTable).values(toCreate);
    }

    const amountBilled = toCreate.reduce(
      (sum, row) => sum + row.amountDue,
      0,
    );

    await db.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "finance.charges.generated",
      recordType: "finance_period",
      recordId: period.id,
      metadata: JSON.stringify({
        year: period.year,
        created: toCreate.length,
        alreadyCharged: verified.length - toCreate.length,
        skipped: 0,
        amountBilled,
      }),
    });

    res.json(
      GenerateAdminFinanceChargesResponse.parse({
        periodId: period.id,
        created: toCreate.length,
        alreadyCharged: verified.length - toCreate.length,
        skipped: 0,
        amountBilled,
      }),
    );
  },
);

router.get(
  "/admin/finance/charges",
  async (req, res): Promise<void> => {
    if (!(await requireFinanceUser(req, res))) return;

    const parsed = GetAdminFinanceChargesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid charge filters." });
      return;
    }
    const { periodId, status, search, page, pageSize } = parsed.data;

    const filters = [];
    if (periodId) filters.push(eq(financeChargesTable.periodId, periodId));
    if (status) filters.push(eq(financeChargesTable.status, status));
    if (search) {
      const term = `%${search}%`;
      filters.push(
        or(
          ilike(financeChargesTable.memberName, term),
          ilike(financeChargesTable.membershipNumber, term),
        ),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(financeChargesTable)
      .where(where);

    const rows = await db
      .select({
        charge: financeChargesTable,
        periodYear: financePeriodsTable.year,
        houseNumber: membershipApplicationsTable.houseNumber,
        streetOrZone: membershipApplicationsTable.streetOrZone,
        email: membershipApplicationsTable.email,
        phone: membershipApplicationsTable.phone,
      })
      .from(financeChargesTable)
      .leftJoin(
        financePeriodsTable,
        eq(financePeriodsTable.id, financeChargesTable.periodId),
      )
      .leftJoin(
        membershipApplicationsTable,
        eq(membershipApplicationsTable.id, financeChargesTable.applicationId),
      )
      .where(where)
      .orderBy(
        desc(financeChargesTable.updatedAt),
        financeChargesTable.memberName,
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json(
      GetAdminFinanceChargesResponse.parse({
        items: rows.map(toAdminCharge),
        total: totalRow?.value ?? 0,
        page,
        pageSize,
      }),
    );
  },
);

router.post(
  "/admin/finance/charges/:id/payments",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const params = RecordAdminFinancePaymentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid charge id." });
      return;
    }
    const parsed = RecordAdminFinancePaymentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Provide a positive amount in ngwee, a payment method, and a date as YYYY-MM-DD.",
      });
      return;
    }
    const body = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [charge] = await tx
        .select()
        .from(financeChargesTable)
        .where(eq(financeChargesTable.id, params.data.id))
        .limit(1);
      if (!charge) return null;

      const [payment] = await tx
        .insert(financePaymentsTable)
        .values({
          chargeId: charge.id,
          amount: body.amount,
          method: body.method,
          reference: optionalText(body.reference),
          paidOn: body.paidOn,
          receivedBy: optionalText(body.receivedBy),
          notes: optionalText(body.notes),
          recordedByUserId: userId,
        })
        .returning();

      const amountPaid = charge.amountPaid + body.amount;
      const status = chargeStatus(
        charge.amountDue,
        amountPaid,
        charge.amountWaived,
      );

      const [updated] = await tx
        .update(financeChargesTable)
        .set({ amountPaid, status, updatedAt: new Date() })
        .where(eq(financeChargesTable.id, charge.id))
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "finance.payment.recorded",
        recordType: "finance_charge",
        recordId: charge.id,
        metadata: JSON.stringify({
          paymentId: payment.id,
          amount: body.amount,
          method: body.method,
          paidOn: body.paidOn,
          amountPaid,
          status,
        }),
      });

      return updated;
    });

    if (!result) {
      res.status(404).json({ error: "Subscription charge not found." });
      return;
    }

    const [period] = await db
      .select({ year: financePeriodsTable.year })
      .from(financePeriodsTable)
      .where(eq(financePeriodsTable.id, result.periodId))
      .limit(1);

    res.json(
      RecordAdminFinancePaymentResponse.parse(
        toAdminCharge({
          charge: result,
          periodYear: period?.year ?? null,
          houseNumber: null,
          streetOrZone: null,
          email: null,
          phone: null,
        }),
      ),
    );
  },
);

router.post(
  "/admin/finance/charges/:id/waive",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const params = WaiveAdminFinanceChargeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid charge id." });
      return;
    }
    const parsed = WaiveAdminFinanceChargeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Provide a positive waiver amount and a reason of at least 3 characters.",
      });
      return;
    }
    const body = parsed.data;

    const outcome = await db.transaction(async (tx) => {
      const [charge] = await tx
        .select()
        .from(financeChargesTable)
        .where(eq(financeChargesTable.id, params.data.id))
        .limit(1);
      if (!charge) return { kind: "missing" as const };

      const amountWaived = charge.amountWaived + body.amount;
      if (amountWaived + charge.amountPaid > charge.amountDue) {
        return { kind: "exceeds" as const };
      }
      const status = chargeStatus(
        charge.amountDue,
        charge.amountPaid,
        amountWaived,
      );

      const [updated] = await tx
        .update(financeChargesTable)
        .set({
          amountWaived,
          status,
          waivedReason: body.reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(financeChargesTable.id, charge.id))
        .returning();

      await tx.insert(auditLogsTable).values({
        actorUserId: userId,
        action: "finance.charge.waived",
        recordType: "finance_charge",
        recordId: charge.id,
        metadata: JSON.stringify({
          amount: body.amount,
          reason: body.reason.trim(),
          amountWaived,
          status,
        }),
      });

      return { kind: "ok" as const, charge: updated };
    });

    if (outcome.kind === "missing") {
      res.status(404).json({ error: "Subscription charge not found." });
      return;
    }
    if (outcome.kind === "exceeds") {
      res.status(400).json({
        error: "The waiver would exceed the amount owed on this charge.",
      });
      return;
    }

    const [period] = await db
      .select({ year: financePeriodsTable.year })
      .from(financePeriodsTable)
      .where(eq(financePeriodsTable.id, outcome.charge.periodId))
      .limit(1);

    res.json(
      WaiveAdminFinanceChargeResponse.parse(
        toAdminCharge({
          charge: outcome.charge,
          periodYear: period?.year ?? null,
          houseNumber: null,
          streetOrZone: null,
          email: null,
          phone: null,
        }),
      ),
    );
  },
);

router.get(
  "/admin/finance/expenses",
  async (req, res): Promise<void> => {
    if (!(await requireFinanceUser(req, res))) return;

    const parsed = GetAdminFinanceExpensesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid expense filters." });
      return;
    }
    const { periodId, category, search, page, pageSize } = parsed.data;

    const filters = [];
    if (periodId) filters.push(eq(financeExpensesTable.periodId, periodId));
    if (category) filters.push(eq(financeExpensesTable.category, category));
    if (search) {
      const term = `%${search}%`;
      filters.push(
        or(
          ilike(financeExpensesTable.description, term),
          ilike(financeExpensesTable.payee, term),
          ilike(financeExpensesTable.receiptReference, term),
        ),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(financeExpensesTable)
      .where(where);

    const rows = await db
      .select({
        expense: financeExpensesTable,
        periodYear: financePeriodsTable.year,
      })
      .from(financeExpensesTable)
      .leftJoin(
        financePeriodsTable,
        eq(financePeriodsTable.id, financeExpensesTable.periodId),
      )
      .where(where)
      .orderBy(desc(financeExpensesTable.paidOn), desc(financeExpensesTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json(
      GetAdminFinanceExpensesResponse.parse({
        items: rows.map(({ expense, periodYear }) => ({
          id: expense.id,
          periodId: expense.periodId,
          periodYear,
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          paidOn: expense.paidOn,
          payee: expense.payee,
          method: expense.method,
          reference: expense.reference,
          receiptReference: expense.receiptReference,
          notes: expense.notes,
          createdAt: expense.createdAt,
        })),
        total: totalRow?.value ?? 0,
        page,
        pageSize,
      }),
    );
  },
);

router.post(
  "/admin/finance/expenses",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const parsed = CreateAdminFinanceExpenseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Provide a category, a description, a positive amount in ngwee and a date as YYYY-MM-DD.",
      });
      return;
    }
    const body = parsed.data;

    let periodYear: number | null = null;
    if (body.periodId) {
      const [period] = await db
        .select({ year: financePeriodsTable.year })
        .from(financePeriodsTable)
        .where(eq(financePeriodsTable.id, body.periodId))
        .limit(1);
      if (!period) {
        res.status(404).json({ error: "Subscription period not found." });
        return;
      }
      periodYear = period.year;
    }

    const [created] = await db
      .insert(financeExpensesTable)
      .values({
        periodId: body.periodId ?? null,
        category: body.category,
        description: body.description.trim(),
        amount: body.amount,
        paidOn: body.paidOn,
        payee: optionalText(body.payee),
        method: body.method ?? null,
        reference: optionalText(body.reference),
        receiptReference: optionalText(body.receiptReference),
        notes: optionalText(body.notes),
        recordedByUserId: userId,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "finance.expense.recorded",
      recordType: "finance_expense",
      recordId: created.id,
      metadata: JSON.stringify({
        category: created.category,
        amount: created.amount,
        paidOn: created.paidOn,
      }),
    });

    res.json(
      CreateAdminFinanceExpenseResponse.parse({
        id: created.id,
        periodId: created.periodId,
        periodYear,
        category: created.category,
        description: created.description,
        amount: created.amount,
        paidOn: created.paidOn,
        payee: created.payee,
        method: created.method,
        reference: created.reference,
        receiptReference: created.receiptReference,
        notes: created.notes,
        createdAt: created.createdAt,
      }),
    );
  },
);

router.delete(
  "/admin/finance/expenses/:id",
  async (req, res): Promise<void> => {
    const userId = await requireFinanceUser(req, res);
    if (!userId) return;

    const params = DeleteAdminFinanceExpenseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid expense id." });
      return;
    }

    const [deleted] = await db
      .delete(financeExpensesTable)
      .where(eq(financeExpensesTable.id, params.data.id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Expense not found." });
      return;
    }

    await db.insert(auditLogsTable).values({
      actorUserId: userId,
      action: "finance.expense.deleted",
      recordType: "finance_expense",
      recordId: deleted.id,
      metadata: JSON.stringify({
        category: deleted.category,
        amount: deleted.amount,
        description: deleted.description,
      }),
    });

    res.json(
      DeleteAdminFinanceExpenseResponse.parse({
        id: deleted.id,
        deleted: true,
      }),
    );
  },
);

router.get(
  "/admin/finance/overview",
  async (req, res): Promise<void> => {
    if (!(await requireFinanceUser(req, res))) return;

    // The active period is the most recent open year; if every year is closed,
    // fall back to the most recent year so the dashboard is never blank.
    const periods = await db
      .select()
      .from(financePeriodsTable)
      .orderBy(desc(financePeriodsTable.year));
    const period =
      periods.find((row) => row.status === "open") ?? periods[0] ?? null;

    if (!period) {
      res.json(
        GetAdminFinanceOverviewResponse.parse({
          period: null,
          membersCharged: 0,
          fullyPaid: 0,
          partPaid: 0,
          outstanding: 0,
          waived: 0,
          amountBilled: 0,
          amountCollected: 0,
          amountOutstanding: 0,
          amountWaived: 0,
          amountSpent: 0,
          creditBalance: 0,
          balance: 0,
          byCategory: [],
          recentPayments: [],
        }),
      );
      return;
    }

    const statusTotals = await db
      .select({
        status: financeChargesTable.status,
        chargeCount: count(),
        amountDue: sql<number>`coalesce(sum(${financeChargesTable.amountDue}), 0)::int`,
        amountPaid: sql<number>`coalesce(sum(${financeChargesTable.amountPaid}), 0)::int`,
        amountWaived: sql<number>`coalesce(sum(${financeChargesTable.amountWaived}), 0)::int`,
      })
      .from(financeChargesTable)
      .where(eq(financeChargesTable.periodId, period.id))
      .groupBy(financeChargesTable.status);

    const byStatus = new Map(statusTotals.map((row) => [row.status, row]));
    const sumOf = (key: "chargeCount" | "amountDue" | "amountPaid" | "amountWaived") =>
      statusTotals.reduce((sum, row) => sum + Number(row[key]), 0);

    const amountBilled = sumOf("amountDue");
    const amountCollected = sumOf("amountPaid");
    const amountWaived = sumOf("amountWaived");
    const amountOutstanding = Math.max(
      0,
      amountBilled - amountCollected - amountWaived,
    );
    // Money received beyond what was billed. It is real money the association
    // holds, so it is reported rather than discarded, and it makes the totals
    // reconcile: billed = collected + waived + outstanding - credit.
    const creditBalance = Math.max(
      0,
      amountCollected + amountWaived - amountBilled,
    );

    const categoryTotals = await db
      .select({
        category: financeExpensesTable.category,
        amount: sql<number>`coalesce(sum(${financeExpensesTable.amount}), 0)::int`,
        entries: count(),
      })
      .from(financeExpensesTable)
      .where(eq(financeExpensesTable.periodId, period.id))
      .groupBy(financeExpensesTable.category)
      .orderBy(desc(sql`sum(${financeExpensesTable.amount})`));

    const amountSpent = categoryTotals.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );

    const recentPayments = await db
      .select({
        payment: financePaymentsTable,
        memberName: financeChargesTable.memberName,
        membershipNumber: financeChargesTable.membershipNumber,
      })
      .from(financePaymentsTable)
      .innerJoin(
        financeChargesTable,
        eq(financeChargesTable.id, financePaymentsTable.chargeId),
      )
      .where(eq(financeChargesTable.periodId, period.id))
      .orderBy(desc(financePaymentsTable.createdAt))
      .limit(8);

    res.json(
      GetAdminFinanceOverviewResponse.parse({
        period: {
          id: period.id,
          year: period.year,
          currency: period.currency,
          label: period.label,
          amountTierLow: period.amountTierLow,
          amountTierStandard: period.amountTierStandard,
          amountTierHigh: period.amountTierHigh,
          status: period.status,
          notes: period.notes,
          createdAt: period.createdAt,
          chargeCount: Number(sumOf("chargeCount")),
          amountBilled,
          amountCollected,
        },
        membersCharged: Number(sumOf("chargeCount")),
        fullyPaid: Number(byStatus.get("paid")?.chargeCount ?? 0),
        partPaid: Number(byStatus.get("part-paid")?.chargeCount ?? 0),
        outstanding: Number(byStatus.get("outstanding")?.chargeCount ?? 0),
        waived: Number(byStatus.get("waived")?.chargeCount ?? 0),
        amountBilled,
        amountCollected,
        amountOutstanding,
        amountWaived,
        amountSpent,
        creditBalance,
        balance: amountCollected - amountSpent,
        byCategory: categoryTotals.map((row) => ({
          category: row.category,
          amount: Number(row.amount),
          entries: Number(row.entries),
        })),
        recentPayments: recentPayments.map(
          ({ payment, memberName, membershipNumber }) => ({
            id: payment.id,
            chargeId: payment.chargeId,
            memberName,
            membershipNumber,
            amount: payment.amount,
            method: payment.method,
            reference: payment.reference,
            paidOn: payment.paidOn,
            receivedBy: payment.receivedBy,
            notes: payment.notes,
            createdAt: payment.createdAt,
          }),
        ),
      }),
    );
  },
);

router.get("/resident/subscription", async (req, res): Promise<void> => {
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const [application] = await db
    .select({ id: membershipApplicationsTable.id })
    .from(membershipApplicationsTable)
    .where(eq(membershipApplicationsTable.userId, userId))
    .limit(1);

  if (!application) {
    res.json(GetMySubscriptionResponse.parse({ currency: "ZMW", charges: [] }));
    return;
  }

  const rows = await db
    .select({
      charge: financeChargesTable,
      year: financePeriodsTable.year,
      currency: financePeriodsTable.currency,
    })
    .from(financeChargesTable)
    .innerJoin(
      financePeriodsTable,
      eq(financePeriodsTable.id, financeChargesTable.periodId),
    )
    .where(eq(financeChargesTable.applicationId, application.id))
    .orderBy(desc(financePeriodsTable.year));

  const chargeIds = rows.map((row) => row.charge.id);
  const payments =
    chargeIds.length > 0
      ? await db
          .select()
          .from(financePaymentsTable)
          .where(inArray(financePaymentsTable.chargeId, chargeIds))
          .orderBy(desc(financePaymentsTable.paidOn))
      : [];
  const paymentsByCharge = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = paymentsByCharge.get(payment.chargeId) ?? [];
    list.push(payment);
    paymentsByCharge.set(payment.chargeId, list);
  }

  res.json(
    GetMySubscriptionResponse.parse({
      currency: rows[0]?.currency ?? "ZMW",
      charges: rows.map(({ charge, year }) => ({
        id: charge.id,
        year,
        membershipNumber: charge.membershipNumber,
        amountDue: charge.amountDue,
        amountPaid: charge.amountPaid,
        amountWaived: charge.amountWaived,
        balance: Math.max(
          0,
          charge.amountDue - charge.amountPaid - charge.amountWaived,
        ),
        status: charge.status,
        dueDate: charge.dueDate,
        payments: (paymentsByCharge.get(charge.id) ?? []).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          paidOn: payment.paidOn,
        })),
      })),
    }),
  );
});

export default router;