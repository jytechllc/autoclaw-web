CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  auth0_id VARCHAR(255) UNIQUE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'starter',
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  domain VARCHAR(255),
  created_by INTEGER REFERENCES users(id),
  plan VARCHAR(50) DEFAULT 'starter',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- Add locale column (run once on existing DBs):
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  website VARCHAR(500),
  description TEXT,
  ga_property_id VARCHAR(20),
  domain VARCHAR(255),
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  agent_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_reports (
  id SERIAL PRIMARY KEY,
  agent_assignment_id INTEGER REFERENCES agent_assignments(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  agent_type VARCHAR(100) NOT NULL,
  task_name VARCHAR(255),
  summary TEXT,
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id),
  title VARCHAR(255) DEFAULT 'New Chat',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id),
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  agent_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  tool_params JSONB,
  status VARCHAR(20) DEFAULT 'running',    -- pending, running, done, error
  result_summary TEXT,
  result_data JSONB,                        -- structured result for async tools (Apify etc.)
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name VARCHAR(255),
  sender_email VARCHAR(255),
  sender_name VARCHAR(255),
  subject TEXT,
  body_html TEXT,
  message_id VARCHAR(500),
  provider VARCHAR(50) DEFAULT 'brevo',     -- brevo, sendgrid
  status VARCHAR(20) DEFAULT 'sent',        -- sent, delivered, opened, clicked, bounced, error
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  bounced_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at);

CREATE TABLE IF NOT EXISTS email_daily_stats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  hard_bounces INTEGER DEFAULT 0,
  soft_bounces INTEGER DEFAULT 0,
  unique_opens INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, project_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_email_daily_stats_user_date ON email_daily_stats(user_id, stat_date);

CREATE TABLE IF NOT EXISTS enrichment_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  provider VARCHAR(50) NOT NULL,      -- apollo, hunter, snov, tavily, apify
  domain VARCHAR(255),                -- searched domain
  results_count INTEGER DEFAULT 0,    -- number of leads returned
  credits_used INTEGER DEFAULT 1,     -- estimated credits consumed
  status VARCHAR(20) DEFAULT 'ok',    -- ok, error, quota_exceeded
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enrichment_usage_user ON enrichment_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_usage_created ON enrichment_usage(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id INTEGER,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  service VARCHAR(50) NOT NULL,
  api_key TEXT NOT NULL,
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL,
  key_prefix VARCHAR(10) NOT NULL,
  name VARCHAR(255),
  scopes TEXT[] DEFAULT '{"read"}',
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Organization-level API keys (shared across org members)
CREATE TABLE IF NOT EXISTS org_api_keys (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  service VARCHAR(50) NOT NULL,
  api_key TEXT NOT NULL,
  label VARCHAR(255),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, service)
);

CREATE INDEX IF NOT EXISTS idx_org_api_keys_org ON org_api_keys(org_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- Knowledge Base (requires pgvector extension)
-- Run once: CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'personal', -- 'org', 'project', 'personal'
  title VARCHAR(500) NOT NULL,
  doc_type VARCHAR(20) NOT NULL, -- 'pdf', 'docx', 'image', 'url', 'text'
  source_url TEXT, -- original URL or blob URL
  file_size INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'ready', 'error'
  error_message TEXT,
  llamaindex_file_id VARCHAR(255), -- LlamaIndex Cloud file reference
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768), -- text-embedding-004 dimension
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_user ON kb_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_org ON kb_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_project ON kb_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_scope ON kb_documents(scope);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Embedding usage tracking (monthly budget)
CREATE TABLE IF NOT EXISTS embedding_usage (
  id SERIAL PRIMARY KEY,
  period VARCHAR(7) NOT NULL,           -- '2026-03' (monthly)
  request_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(period)
);

-- Skills catalog
CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Per-user skill activation
CREATE TABLE IF NOT EXISTS user_skills (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);

-- Seed default skills
INSERT INTO skills (key, category, sort_order) VALUES
  ('skillColdEmail', 'email', 1),
  ('skillFollowUp', 'email', 2),
  ('skillNewsletter', 'email', 3),
  ('skillEmailTemplate', 'email', 4),
  ('skillBlogWriter', 'seo', 5),
  ('skillKeywordResearch', 'seo', 6),
  ('skillSeoAudit', 'seo', 7),
  ('skillMetaOptimizer', 'seo', 8),
  ('skillWebScraper', 'leads', 9),
  ('skillEnrichment', 'leads', 10),
  ('skillCrmSync', 'leads', 11),
  ('skillTweetComposer', 'social', 13),
  ('skillContentScheduler', 'social', 14),
  ('skillSocialListening', 'social', 15),
  ('skillHashtagResearch', 'social', 16),
  ('skillTrafficDashboard', 'analytics', 17),
  ('skillCampaignAnalytics', 'analytics', 18),
  ('skillConversionTracking', 'analytics', 19),
  ('skillReportGenerator', 'analytics', 20),
  ('skillWorkflowBuilder', 'automation', 21),
  ('skillWebhookTrigger', 'automation', 22),
  ('skillDataPipeline', 'automation', 23),
  ('skillTaskScheduler', 'automation', 24)
ON CONFLICT (key) DO NOTHING;

-- CRM Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  company VARCHAR(255),
  position VARCHAR(255),
  phone VARCHAR(50),
  source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'brevo', 'apollo', 'hunter', 'snov', 'csv', 'import'
  source_detail VARCHAR(500),          -- e.g. "Project: xxx", "Task: Lead Prospecting", "File: contacts.csv"
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  brevo_id BIGINT,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  hard_bounces INTEGER DEFAULT 0,
  soft_bounces INTEGER DEFAULT 0,
  last_opened_at TIMESTAMP,
  stats_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

-- Referral program
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  referred_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  referral_code VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'signed_up', 'subscribed'
  referred_email VARCHAR(255),
  commission_rate NUMERIC DEFAULT 0.05, -- 5%
  created_at TIMESTAMP DEFAULT NOW(),
  converted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id SERIAL PRIMARY KEY,
  referral_id INTEGER REFERENCES referrals(id) ON DELETE CASCADE,
  referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL, -- commission amount in cents
  currency VARCHAR(3) DEFAULT 'usd',
  payment_amount NUMERIC NOT NULL, -- original payment amount
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'paid', 'cancelled'
  stripe_payment_id VARCHAR(255),
  period VARCHAR(7), -- '2026-03'
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_id);

-- Business Partners (global catalog, admin-managed, visible to all users)
CREATE TABLE IF NOT EXISTS business_partners (
  id SERIAL PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  website VARCHAR(500),
  address TEXT,
  partner_type VARCHAR(50) DEFAULT 'partner', -- 'supplier', 'vendor', 'distributor', 'reseller', 'partner', 'other'
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'pending'
  description TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  logo_url VARCHAR(500),
  discount VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_partners_type ON business_partners(partner_type);
CREATE INDEX IF NOT EXISTS idx_business_partners_status ON business_partners(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_partners_name ON business_partners(name);

-- Seed global partners
INSERT INTO business_partners (name, website, partner_type, status, description, logo_url, discount)
VALUES
  ('Numix XPilot', 'https://www.numix.co/numix-xpilot', 'partner', 'active', 'Tax Credits on Autopilot with Full Stack Accounting & CFO services by Numix', 'https://framerusercontent.com/images/MfxaJudXEVxeeht8WnKAsVFWXg.png', '10% off')
ON CONFLICT (name) DO NOTHING;

-- Email templates library (multi-language, project-scoped)
CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES agent_assignments(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  language VARCHAR(10) DEFAULT 'en',          -- en, zh, zh-TW, fr, etc.
  category VARCHAR(50) DEFAULT 'cold_outreach', -- cold_outreach, follow_up, newsletter, custom
  tags TEXT[] DEFAULT '{}',
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_user ON email_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_project ON email_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_language ON email_templates(language);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

-- X (Twitter) multi-account support
CREATE TABLE IF NOT EXISTS x_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,                -- display name, e.g. "Company Official", "Personal"
  username VARCHAR(255),                       -- @handle, populated after verification
  x_user_id VARCHAR(255),                      -- X platform user ID
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_token_secret TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'active',         -- active, error, revoked
  last_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_x_accounts_user ON x_accounts(user_id);

-- User budget settings
CREATE TABLE IF NOT EXISTS user_budgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  monthly_limit NUMERIC,
  total_limit NUMERIC,
  alert_thresholds INTEGER[] DEFAULT '{80,100}',
  auto_pause BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_library (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title VARCHAR(500),
  description TEXT,
  image_url TEXT NOT NULL,
  blob_url TEXT,
  model VARCHAR(255),
  provider VARCHAR(100),
  prompt TEXT,
  tags TEXT[] DEFAULT '{}',
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  status VARCHAR(20) DEFAULT 'ready',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_library_user ON media_library(user_id);
CREATE INDEX IF NOT EXISTS idx_media_library_project ON media_library(project_id);

-- Model benchmarks: stores weekly OpenRouter free-model benchmark results
CREATE TABLE IF NOT EXISTS model_benchmarks (
  id SERIAL PRIMARY KEY,
  model_id VARCHAR(255) NOT NULL,          -- OpenRouter model ID e.g. "qwen/qwen3-coder-480b-a35b:free"
  model_name VARCHAR(255) NOT NULL,
  provider VARCHAR(100),
  context_length INTEGER DEFAULT 0,
  score_tool_calling REAL DEFAULT 0,       -- 0-100: can it output tool_call JSON?
  score_multilingual REAL DEFAULT 0,       -- 0-100: Chinese in → Chinese out
  score_instruction REAL DEFAULT 0,        -- 0-100: follows complex system prompts
  score_speed REAL DEFAULT 0,              -- 0-100: response latency
  score_total REAL DEFAULT 0,              -- weighted average
  latency_ms INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  error_message TEXT,
  run_id VARCHAR(50) NOT NULL,             -- groups results from same benchmark run
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_model_benchmarks_run ON model_benchmarks(run_id);
CREATE INDEX IF NOT EXISTS idx_model_benchmarks_score ON model_benchmarks(score_total DESC);
CREATE INDEX IF NOT EXISTS idx_model_benchmarks_created ON model_benchmarks(created_at DESC);

-- ============================================
-- WeChat Pay Integration
-- ============================================

-- Add WeChat Pay columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_order_no VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_transaction_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'stripe'; -- 'stripe', 'wechat_pay'
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'inactive'; -- 'active', 'inactive', 'cancelled'

-- Payments table for tracking all payment transactions
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_no VARCHAR(255) UNIQUE NOT NULL,
  transaction_id VARCHAR(255),
  payment_method VARCHAR(50) NOT NULL, -- 'stripe', 'wechat_pay'
  amount NUMERIC NOT NULL, -- amount in cents
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'success', 'failed', 'refunded', 'closed'
  plan VARCHAR(50), -- 'growth', 'scale', etc.
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_no ON payments(order_no);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- ============================================
-- YouTube channel management
-- ============================================

-- Stores Google OAuth tokens scoped to YouTube. One row per user (MVP single channel).
CREATE TABLE IF NOT EXISTS youtube_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  channel_id VARCHAR(255),
  channel_title VARCHAR(255),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP NOT NULL,
  scope TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_tokens_user ON youtube_tokens(user_id);

-- Tracks scheduled / completed uploads. publish_at uses YouTube's native scheduled publish.
CREATE TABLE IF NOT EXISTS youtube_uploads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  category_id VARCHAR(10) DEFAULT '22',         -- 22 = People & Blogs (YouTube default)
  privacy_status VARCHAR(20) DEFAULT 'public',  -- 'public' | 'unlisted' | 'private'
  publish_at TIMESTAMP,                         -- if set, video is uploaded as private and YouTube auto-publishes at this time
  video_url TEXT NOT NULL,                      -- source URL we fetch from to upload
  status VARCHAR(20) DEFAULT 'pending',         -- 'pending' | 'uploading' | 'scheduled' | 'published' | 'failed'
  youtube_video_id VARCHAR(50),                 -- populated after upload
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_uploads_user ON youtube_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_status ON youtube_uploads(status);
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_publish_at ON youtube_uploads(publish_at);

-- ============================================================
-- Google Ads / Ad Credits
-- Previously created at runtime by ensureAdsTables() and
-- ensureAdCreditsTables(). Lifted here so the schema has a single
-- source of truth. See docs/google-ads-audit.md D-2.
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_accounts (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  account_id VARCHAR(100) NOT NULL,
  account_name VARCHAR(255),
  credentials JSONB,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, platform, account_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE SET NULL,
  platform VARCHAR(20) NOT NULL,
  platform_campaign_id VARCHAR(255),
  campaign_name VARCHAR(255) NOT NULL,
  channel VARCHAR(50),
  daily_budget NUMERIC(12, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(20),
  metadata JSONB,
  -- Budget cap columns for credit reservation
  total_budget_cents BIGINT DEFAULT 0,
  reserved_cents BIGINT DEFAULT 0,
  spent_cents BIGINT DEFAULT 0,
  closed BOOLEAN DEFAULT false,
  -- Owner project — per Epic 2 in autoclaw-business-architecture-design.
  -- Nullable + ON DELETE SET NULL so deleting a project doesn't orphan campaigns;
  -- they fall back to "no project" status until reassigned.
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(platform, platform_campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_campaigns_project_id ON campaigns(project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ad_credits (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  reserved_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_credit_transactions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  reserved_after_cents BIGINT NOT NULL,
  reference_type VARCHAR(50),
  reference_id VARCHAR(255),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_credit_tx_org ON ad_credit_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_credit_tx_ref ON ad_credit_transactions(reference_type, reference_id);

-- ============================================================
-- PMAX Asset Groups (KAN-53)
-- ============================================================
-- Performance Max has no ad groups — instead, asset groups bundle
-- headlines, long headlines, descriptions, images, logos, and (optional)
-- videos under one PMAX campaign. A PMAX campaign needs at least one
-- asset group meeting Google-Ads-required minimums before it becomes
-- eligible to serve.
--
-- See docs/google-ads-audit.md PR #2c. Full backend implementation
-- lands in PR #18b; this PR (KAN-53 scaffold) defines the data layer
-- and TypeScript contracts only.

CREATE TABLE IF NOT EXISTS asset_groups (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform_asset_group_id VARCHAR(255),    -- Google Ads resourceName tail
  name VARCHAR(255) NOT NULL,
  final_url TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'PAUSED',     -- ENABLED / PAUSED / REMOVED
  primary_status VARCHAR(50),              -- OPERATING / LIMITED / NOT_ELIGIBLE / etc.
  primary_status_reasons JSONB,            -- e.g. ["ASSET_GROUP_DISAPPROVED"]
  ad_strength VARCHAR(20),                 -- POOR / AVERAGE / GOOD / EXCELLENT
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(campaign_id, platform_asset_group_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_groups_campaign ON asset_groups(campaign_id);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_group_id INTEGER NOT NULL REFERENCES asset_groups(id) ON DELETE CASCADE,
  platform_asset_id VARCHAR(255),          -- Google Ads asset resourceName
  -- Google Ads PMAX field_type for this asset slot:
  -- HEADLINE / LONG_HEADLINE / DESCRIPTION / MARKETING_IMAGE /
  -- SQUARE_MARKETING_IMAGE / LOGO / LANDSCAPE_LOGO / BUSINESS_NAME /
  -- YOUTUBE_VIDEO / CALL_TO_ACTION_SELECTION
  field_type VARCHAR(40) NOT NULL,
  -- Exactly one of text_value / image_url / youtube_video_id is set,
  -- depending on field_type. Kept flat (vs. polymorphic table) for
  -- query simplicity at this scale.
  text_value TEXT,
  image_url TEXT,
  youtube_video_id VARCHAR(20),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_group ON assets(asset_group_id);
CREATE INDEX IF NOT EXISTS idx_assets_field_type ON assets(asset_group_id, field_type);

-- Latest AI optimization digest per campaign (cron-generated nightly or
-- refreshed manually from the detail page). Latest-only by design — history
-- lives in the audit log. See docs/google-ads-audit.md changelog 2026-07-03.
CREATE TABLE IF NOT EXISTS campaign_recommendations (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'cron',   -- 'cron' | 'manual'
  recommendations JSONB NOT NULL,               -- sanitized Recommendation[]
  provider VARCHAR(40),
  model VARCHAR(80),
  generated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_recommendations_org ON campaign_recommendations(org_id);

-- ============================================================================
-- Workflows (cold outreach + multi-stage follow-up automation)
-- ============================================================================

-- A workflow is a reusable definition: trigger + ordered steps (email/wait/condition).
-- definition jsonb shape:
--   {
--     "trigger": { "type": "new_lead" | "form_submit" | "schedule" | "webhook" },
--     "steps": [
--       { "kind": "send_email", "template_id": 12, "delay_seconds": 0 },
--       { "kind": "wait", "delay_seconds": 259200 },
--       { "kind": "send_email", "template_id": 13, "delay_seconds": 0 },
--       { "kind": "stop_if_replied" }
--     ]
--   }
CREATE TABLE IF NOT EXISTS workflows (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft',  -- 'draft' | 'active' | 'paused'
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  runs INTEGER DEFAULT 0,
  last_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- One row per (contact, workflow) — tracks where each lead sits in the funnel.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'running',  -- 'running' | 'completed' | 'stopped_replied' | 'cancelled'
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE(workflow_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_contact ON workflow_runs(contact_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

-- One row per future email to send. dispatch-followups cron flips these to email_logs/email_review.
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id SERIAL PRIMARY KEY,
  workflow_run_id INTEGER REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
  step_index INTEGER NOT NULL,
  run_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'queued_for_review' | 'sent' | 'cancelled'
  cancelled_reason TEXT,
  dispatched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_run_at ON scheduled_emails(run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_workflow ON scheduled_emails(workflow_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_contact ON scheduled_emails(contact_id);
