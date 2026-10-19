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
} from "../lib/auth";
import { pushToGoogleSheets } from "../lib/google-sheets";
import { isUniqueViolation } from "../lib/pg-errors";
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
  const twoThirdsThreshold =
    denominator !== null ? Math.ceil((denominator * 2) / 3) : null;
  const minimumQuorum = denominator !== null ? Math.ceil(denominator * 0.25) : null;
  const signaturesRemaining =
    proposedThreshold !== null
      ? Math.max(proposedThreshold - acceptedPetitionSignatures, 0)
      : null;
  const thresholdReached =
    proposedThreshold !== null
      ? acceptedPetitionSignatures >= proposedThreshold
      : null;
  const supportPercentage =
    denominator !== null && denominator > 0
      ? (acceptedPetitionSignatures / denominator) * 100
      : null;

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
      twoThirdsThreshold,
      minimumQuorum,
      signaturesRemaining,
      thresholdReached,
      supportPercentage,
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
  const twoThirdsThreshold =
    denominator !== null ? Math.ceil((denominator * 2) / 3) : null;
  const minimumQuorum = denominator !== null ? Math.ceil(denominator * 0.25) : null;
  const signaturesRemaining =
    proposedThreshold !== null
      ? Math.max(proposedThreshold - acceptedPetitionSignatures, 0)
      : null;
  const thresholdReached =
    proposedThreshold !== null
      ? acceptedPetitionSignatures >= proposedThreshold
      : null;
  const supportPercentage =
    denominator !== null && denominator > 0
      ? (acceptedPetitionSignatures / denominator) * 100
      : null;

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
      twoThirdsThreshold,
      minimumQuorum,
      signaturesRemaining,
      thresholdReached,
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
        membershipNumber: membershipApplicationsTable.membershipNumber,
        admittedAt: membershipApplicationsTable.admittedAt,
      })
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, params.data.id))
      .limit(1);
    if (!existing) return null;

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
      action: "membership.application.reviewed",
      recordType: "membership_application",
      recordId: application.id,
      metadata: JSON.stringify({
        status: application.status,
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

export default router;
