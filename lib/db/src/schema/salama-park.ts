import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const residentApplicationStatus = pgEnum("resident_application_status", [
  "pending-verification",
  "clarification-requested",
  "verified",
  "rejected",
]);

export const associationRole = pgEnum("association_role", [
  "resident",
  "returning-officer",
  "scrutineer",
  "administrator",
]);

export const petitionStatus = pgEnum("petition_status", [
  "draft",
  "approved",
  "closed",
]);

export const petitionSignatureStatus = pgEnum("petition_signature_status", [
  "accepted",
  "disputed",
  "rejected",
  "withdrawn",
]);

export const subscriptionVote = pgEnum("subscription_vote", [
  "k50",
  "k100",
  "k150",
]);

export const householdType = pgEnum("household_type", [
  "homeowner",
  "tenant",
]);

export const gender = pgEnum("gender", ["male", "female", "other"]);

export const residencyStatus = pgEnum("residency_status", [
  "owner-occupier",
  "tenant",
  "owner-landlord",
  "family-member",
]);

export const membershipCategory = pgEnum("membership_category", [
  "full",
  "associate",
  "honorary",
]);

export const reliefOption = pgEnum("relief_option", [
  "yes",
  "no",
  "not-applicable",
]);

export const paymentMethod = pgEnum("payment_method", [
  "mobile-money",
  "bank-transfer",
  "cash",
]);

export const preferredLanguage = pgEnum("preferred_language", [
  "english",
  "nyanja",
  "bemba",
  "tonga",
  "other",
]);

export const applicationRejectionCategory = pgEnum(
  "application_rejection_category",
  ["duplicate", "not-resident", "incomplete-declaration", "other"],
);

export const documentPublicationStatus = pgEnum(
  "document_publication_status",
  ["draft", "approved", "published", "archived"],
);

export const announcementPublicationStatus = pgEnum(
  "announcement_publication_status",
  ["draft", "published", "archived"],
);

export const profilesTable = pgTable("profiles", {
  id: text("id").primaryKey(), // Clerk user ID
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export const userRolesTable = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    role: associationRole("role").notNull(),
    assignedBy: text("assigned_by"),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("user_roles_user_active_idx").on(table.userId, table.revokedAt),
  ],
).enableRLS();

export const membershipApplicationsTable = pgTable(
  "membership_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" })
      .unique(),
    fullName: text("full_name").notNull(),
    houseNumber: text("house_number").notNull(),
    streetOrZone: text("street_or_zone").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    preferredNotification: text("preferred_notification").notNull(),
    status: residentApplicationStatus("status")
      .notNull()
      .default("pending-verification"),
    livesInSalamaPark: boolean("lives_in_salama_park").notNull(),
    // Section A — Personal identification
    nrcNumber: text("nrc_number"),
    passportNumber: text("passport_number"),
    dateOfBirth: text("date_of_birth"),
    gender: gender("gender"),
    nationality: text("nationality"),
    phoneAlt: text("phone_alt"),
    plotNumber: text("plot_number"),
    // Section B — Residency
    residencyStatus: residencyStatus("residency_status"),
    residencySince: text("residency_since"),
    ownsProperty: boolean("owns_property").notNull().default(false),
    propertyPlots: text("property_plots"),
    wardRegisteredVoter: boolean("ward_registered_voter"),
    // Section C — Membership category
    membershipCategory: membershipCategory("membership_category"),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    membershipNumber: text("membership_number"),
    otherAssociationMember: boolean("other_association_member"),
    otherAssociationName: text("other_association_name"),
    // Section D — Subscription poll
    subscriptionVote: subscriptionVote("subscription_vote"),
    agreeToPayAdopted: boolean("agree_to_pay_adopted").notNull().default(false),
    reliefOption: reliefOption("relief_option"),
    paymentMethod: paymentMethod("payment_method"),
    // Section E — Declarations and signature
    declarationConfirmResident: boolean("declaration_confirm_resident")
      .notNull()
      .default(false),
    declarationReadConstitution: boolean("declaration_read_constitution")
      .notNull()
      .default(false),
    declarationMemberRegister: boolean("declaration_member_register")
      .notNull()
      .default(false),
    declarationVoterRoll: boolean("declaration_voter_roll")
      .notNull()
      .default(false),
    declarationContactConsent: boolean("declaration_contact_consent")
      .notNull()
      .default(false),
    declarationNoSubscription: boolean("declaration_no_subscription")
      .notNull()
      .default(false),
    declarationUndertakePayment: boolean("declaration_undertake_payment")
      .notNull()
      .default(false),
    declarationUnderstandRelief: boolean("declaration_understand_relief")
      .notNull()
      .default(false),
    signatureName: text("signature_name"),
    // Section F — Verification (association officials only)
    receivedBy: text("received_by"),
    verifiedAgainstNrc: boolean("verified_against_nrc"),
    rejectionCategory: applicationRejectionCategory("rejection_category"),
    verificationNotes: text("verification_notes"),
    // Section G — Associate and honorary members
    principalResidenceAddress: text("principal_residence_address"),
    associationBasis: text("association_basis"),
    nominatedBy: text("nominated_by"),
    // Section H — Optional planning and skills
    occupation: text("occupation"),
    willingToVolunteer: boolean("willing_to_volunteer").notNull().default(false),
    volunteerSkills: text("volunteer_skills"),
    accessNeeds: text("access_needs"),
    preferredLanguage: preferredLanguage("preferred_language"),
    // Additional household and emergency details
    adultsInHousehold: integer("adults_in_household"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),
    privacyNoticeAcceptedAt: timestamp("privacy_notice_accepted_at", {
      withTimezone: true,
    }).notNull(),
    decisionReason: text("decision_reason"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("membership_applications_status_submitted_idx").on(
      table.status,
      table.submittedAt,
    ),
    index("membership_applications_name_idx").on(table.fullName),
  ],
).enableRLS();

export const registerSnapshotsTable = pgTable("register_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull().unique(),
  denominator: integer("denominator").notNull(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  rulesDescription: text("rules_description").notNull(),
  integrityHash: text("integrity_hash").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const governanceDocumentsTable = pgTable(
  "governance_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    version: text("version").notNull(),
    description: text("description").notNull(),
    storagePath: text("storage_path"),
    downloadUrl: text("download_url"),
    checksum: text("checksum"),
    publicationStatus: documentPublicationStatus("publication_status")
      .notNull()
      .default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("governance_documents_publication_idx").on(
      table.publicationStatus,
      table.publishedAt,
    ),
  ],
).enableRLS();

export const petitionConfigurationsTable = pgTable(
  "petition_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    petitionVersion: text("petition_version").notNull(),
    constitutionVersion: text("constitution_version").notNull(),
    eligibilityText: text("eligibility_text").notNull(),
    openingAt: timestamp("opening_at", { withTimezone: true }),
    closingAt: timestamp("closing_at", { withTimezone: true }),
    registerSnapshotId: uuid("register_snapshot_id").references(
      () => registerSnapshotsTable.id,
      { onDelete: "restrict" },
    ),
    proposedThreshold: integer("proposed_threshold"),
    status: petitionStatus("status").notNull().default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("petition_configurations_status_idx").on(
      table.status,
      table.openingAt,
    ),
  ],
).enableRLS();

export const petitionSubmissionsTable = pgTable(
  "petition_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "restrict" }),
    petitionConfigurationId: uuid("petition_configuration_id")
      .notNull()
      .references(() => petitionConfigurationsTable.id, { onDelete: "restrict" }),
    petitionVersion: text("petition_version").notNull(),
    constitutionVersion: text("constitution_version").notNull(),
    declarationVersion: text("declaration_version").notNull(),
    declarations: text("declarations").notNull(),
    subscriptionVote: subscriptionVote("subscription_vote"),
    onlineVotingConsent: boolean("online_voting_consent").notNull().default(false),
    willingToVolunteer: boolean("willing_to_volunteer").notNull().default(false),
    volunteerSkills: text("volunteer_skills"),
    householdType: householdType("household_type"),
    adultsInHousehold: integer("adults_in_household"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),
    onMembersRegister: boolean("on_members_register"),
    duplicateFlag: boolean("duplicate_flag"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationNotes: text("verification_notes"),
    status: petitionSignatureStatus("status").notNull().default("accepted"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("petition_submissions_one_active_per_resident_idx")
      .on(table.userId, table.petitionConfigurationId)
      .where(sql`${table.status} = 'accepted'`),
    index("petition_submissions_config_status_idx").on(
      table.petitionConfigurationId,
      table.status,
    ),
  ],
).enableRLS();

export const announcementsTable = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publicationStatus: announcementPublicationStatus("publication_status")
      .notNull()
      .default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("announcements_publication_idx").on(
      table.publicationStatus,
      table.publishedAt,
    ),
  ],
).enableRLS();

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
  ],
).enableRLS();

