import { z } from "zod";

// ── Shared primitives ──
const email = z.string().email().max(255);
const id = z.number().int().positive();
const shortText = z.string().min(1).max(255);
const longText = z.string().max(5000).optional();
const url = z.string().url().max(500).optional().or(z.literal(""));
const domain = z.string().max(255).optional().nullable();
const locale = z.enum(["en", "zh", "zh-TW", "fr"]).optional();

// ── Projects ──
export const createProjectSchema = z.object({
  action: z.literal("create_project"),
  name: shortText,
  website: url,
  description: longText,
  domain,
  ga_property_id: z.string().max(20).optional().nullable(),
});

export const activateAgentSchema = z.object({
  action: z.literal("activate_agent"),
  project_id: id,
  agent_type: z.enum([
    "email_marketing", "seo_content", "lead_prospecting",
    "social_media", "product_manager", "sales_followup", "orchestrator",
    "recruiting",
  ]),
  locale,
});

export const deactivateAgentSchema = z.object({
  action: z.literal("deactivate_agent"),
  agent_id: id,
});

export const resolveBlockerSchema = z.object({
  action: z.literal("resolve_blocker"),
  agent_id: id,
  blocker_index: z.number().int().min(0),
  value: z.string().max(2000).optional(),
});

export const updateAgentConfigSchema = z.object({
  action: z.literal("update_agent_config"),
  agent_id: id,
  config: z.record(z.string(), z.unknown()),
});

export const updateProjectSchema = z.object({
  action: z.literal("update_project"),
  project_id: id,
  name: z.string().min(1).max(255).optional(),
  website: url,
  ga_property_id: z.string().max(20).optional().nullable(),
  description: longText,
  domain,
  contact_name: z.string().max(200).optional().nullable(),
  contact_email: z.string().email().max(200).optional().nullable(),
  contact_phone: z.string().max(50).optional().nullable(),
});

export const deleteProjectSchema = z.object({
  action: z.literal("delete_project"),
  project_id: id,
});

export const projectActionSchema = z.discriminatedUnion("action", [
  createProjectSchema,
  activateAgentSchema,
  deactivateAgentSchema,
  resolveBlockerSchema,
  updateAgentConfigSchema,
  updateProjectSchema,
  deleteProjectSchema,
]);

// ── Organizations ──
export const createOrgSchema = z.object({
  action: z.literal("create"),
  name: shortText,
  domain,
});

export const addMemberSchema = z.object({
  action: z.literal("add_member"),
  org_id: id,
  email,
  role: z.enum(["admin", "member"]).optional(),
});

export const removeMemberSchema = z.object({
  action: z.literal("remove_member"),
  org_id: id,
  member_email: email,
});

export const assignProjectSchema = z.object({
  action: z.literal("assign_project"),
  org_id: id,
  project_id: id,
});

export const updateMemberRoleSchema = z.object({
  action: z.literal("update_role"),
  org_id: id,
  member_email: email,
  role: z.enum(["admin", "member"]),
});

export const renameOrgSchema = z.object({
  action: z.literal("rename"),
  org_id: id,
  name: shortText,
});

export const deleteOrgSchema = z.object({
  action: z.literal("delete"),
  org_id: id,
});

export const checkOrgNameSchema = z.object({
  action: z.literal("check_name"),
  name: shortText,
});

export const joinOrgSchema = z.object({
  action: z.literal("join"),
  name: shortText,
});

export const getMembersSchema = z.object({
  action: z.literal("get_members"),
  org_id: id,
});

export const orgActionSchema = z.discriminatedUnion("action", [
  createOrgSchema,
  addMemberSchema,
  removeMemberSchema,
  assignProjectSchema,
  updateMemberRoleSchema,
  renameOrgSchema,
  deleteOrgSchema,
  checkOrgNameSchema,
  joinOrgSchema,
  getMembersSchema,
]);

// ── Team Members ──
export const inviteTeamMemberSchema = z.object({
  email,
  project_id: id,
});

// ── API Keys (BYOK) ──
const allowedService = z.enum(["brevo", "sendgrid", "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "apollo", "apify", "hunter", "snov_id", "snov_secret", "snov_api_id", "snov_api_secret", "tavily", "firecrawl", "xai", "z_ai", "pdl", "abstract", "openai", "anthropic", "google", "alibaba", "cerebras", "vercel", "clawhub", "xpilot", "twitter_api_key", "twitter_api_secret", "twitter_access_token", "twitter_access_token_secret", "tiktok_client_key", "tiktok_client_secret", "blob_token", "worker_url", "worker_secret"]);

export const upsertApiKeySchema = z.object({
  action: z.literal("upsert"),
  service: allowedService,
  api_key: z.string().min(8).max(500),
  label: z.string().max(255).optional().nullable(),
});

export const deleteApiKeySchema = z.object({
  action: z.literal("delete"),
  service: allowedService,
});

export const revealApiKeySchema = z.object({
  action: z.literal("reveal"),
  service: allowedService,
});

export const createPlatformKeySchema = z.object({
  action: z.literal("create"),
  name: z.string().max(255).optional().nullable(),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1).optional(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const revokePlatformKeySchema = z.object({
  action: z.literal("revoke"),
  key_id: z.number().int().positive(),
});

export const orgUpsertApiKeySchema = z.object({
  action: z.literal("org_upsert"),
  org_id: z.number(),
  service: allowedService,
  api_key: z.string().min(8).max(500),
  label: z.string().max(255).optional().nullable(),
});

export const orgDeleteApiKeySchema = z.object({
  action: z.literal("org_delete"),
  org_id: z.number(),
  service: allowedService,
});

export const orgRevealApiKeySchema = z.object({
  action: z.literal("org_reveal"),
  org_id: z.number(),
  service: allowedService,
});

export const apiKeyActionSchema = z.discriminatedUnion("action", [
  upsertApiKeySchema,
  deleteApiKeySchema,
  revealApiKeySchema,
  createPlatformKeySchema,
  revokePlatformKeySchema,
  orgUpsertApiKeySchema,
  orgDeleteApiKeySchema,
  orgRevealApiKeySchema,
]);

// ── Business Partners ──
const partnerType = z.enum(["supplier", "vendor", "distributor", "reseller", "partner", "other"]);
const partnerStatus = z.enum(["active", "inactive", "pending"]);

export const createPartnerSchema = z.object({
  action: z.literal("create"),
  name: shortText,
  contact_person: z.string().max(255).optional().nullable(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  website: url,
  address: longText,
  partner_type: partnerType.optional(),
  status: partnerStatus.optional(),
  description: longText,
  notes: longText,
  tags: z.array(z.string().max(100)).max(20).optional(),
  logo_url: url,
  discount: z.string().max(100).optional().nullable(),
});

export const updatePartnerSchema = z.object({
  action: z.literal("update"),
  id,
  name: shortText.optional(),
  contact_person: z.string().max(255).optional().nullable(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(50).optional().nullable(),
  website: url,
  address: longText,
  partner_type: partnerType.optional(),
  status: partnerStatus.optional(),
  description: longText,
  notes: longText,
  tags: z.array(z.string().max(100)).max(20).optional(),
  logo_url: url,
  discount: z.string().max(100).optional().nullable(),
});

export const deletePartnerSchema = z.object({
  action: z.literal("delete"),
  id,
});

export const partnerActionSchema = z.discriminatedUnion("action", [
  createPartnerSchema,
  updatePartnerSchema,
  deletePartnerSchema,
]);

// ── Recruiting ──
const candidateStatus = z.enum(["new", "screening", "interview", "offer", "hired", "rejected"]);
const candidateSource = z.enum(["manual", "linkedin", "referral", "job_board"]);
const positionStatus = z.enum(["draft", "open", "closed"]);

export const createCandidateSchema = z.object({
  action: z.literal("create_candidate"),
  first_name: shortText,
  last_name: z.string().max(100).optional(),
  email,
  phone: z.string().max(50).optional().nullable(),
  resume_url: url,
  linkedin_url: url,
  skills: z.string().max(2000).optional().nullable(),
  experience: z.string().max(2000).optional().nullable(),
  current_company: z.string().max(255).optional().nullable(),
  position_id: id.optional().nullable(),
  source: candidateSource.optional(),
  tags: z.string().max(500).optional().nullable(),
  notes: longText,
});

export const updateCandidateSchema = z.object({
  action: z.literal("update_candidate"),
  id,
  first_name: shortText.optional(),
  last_name: z.string().max(100).optional(),
  email: email.optional(),
  phone: z.string().max(50).optional().nullable(),
  resume_url: url,
  linkedin_url: url,
  skills: z.string().max(2000).optional().nullable(),
  experience: z.string().max(2000).optional().nullable(),
  current_company: z.string().max(255).optional().nullable(),
  position_id: id.optional().nullable(),
  source: candidateSource.optional(),
  tags: z.string().max(500).optional().nullable(),
  notes: longText,
});

export const moveCandidateSchema = z.object({
  action: z.literal("move_candidate"),
  id,
  status: candidateStatus,
});

export const deleteCandidateSchema = z.object({
  action: z.literal("delete_candidate"),
  id,
});

const salaryType = z.enum(["hourly", "monthly", "yearly"]);

export const createPositionSchema = z.object({
  action: z.literal("create_position"),
  title: shortText,
  description: longText,
  department: z.string().max(100).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  salary_min: z.number().min(0).optional().nullable(),
  salary_max: z.number().min(0).optional().nullable(),
  salary_type: salaryType.optional(),
  required_skills: z.string().max(2000).optional().nullable(),
  status: positionStatus.optional(),
  visa_sponsorship: z.boolean().optional(),
});

export const updatePositionSchema = z.object({
  action: z.literal("update_position"),
  id,
  title: shortText.optional(),
  description: longText,
  department: z.string().max(100).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  salary_min: z.number().min(0).optional().nullable(),
  salary_max: z.number().min(0).optional().nullable(),
  salary_type: salaryType.optional(),
  required_skills: z.string().max(2000).optional().nullable(),
  status: positionStatus.optional(),
  visa_sponsorship: z.boolean().optional(),
});

export const deletePositionSchema = z.object({
  action: z.literal("delete_position"),
  id,
});

export const createInterviewSchema = z.object({
  action: z.literal("create_interview"),
  candidate_id: id,
  interviewer: shortText,
  scheduled_at: z.string().min(1),
  duration_minutes: z.number().int().min(15).max(480).optional(),
});

export const updateInterviewSchema = z.object({
  action: z.literal("update_interview"),
  id,
  feedback: longText,
  rating: z.number().int().min(1).max(5).optional().nullable(),
});

export const deleteInterviewSchema = z.object({
  action: z.literal("delete_interview"),
  id,
});

export const recruitingActionSchema = z.discriminatedUnion("action", [
  createCandidateSchema, updateCandidateSchema, moveCandidateSchema, deleteCandidateSchema,
  createPositionSchema, updatePositionSchema, deletePositionSchema,
  createInterviewSchema, updateInterviewSchema, deleteInterviewSchema,
]);

// ── Helper ──
export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { error: msg };
  }
  return { data: result.data };
}
