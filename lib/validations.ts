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
const allowedService = z.enum(["brevo", "sendgrid", "apollo", "apify", "hunter", "snov_api_id", "snov_api_secret", "openai", "anthropic", "google", "alibaba", "cerebras", "vercel", "clawhub", "xpilot", "twitter_api_key", "twitter_api_secret", "twitter_access_token", "twitter_access_token_secret", "tiktok_client_key", "tiktok_client_secret", "blob_token", "worker_url", "worker_secret"]);

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

// ── Helper ──
export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { error: msg };
  }
  return { data: result.data };
}
