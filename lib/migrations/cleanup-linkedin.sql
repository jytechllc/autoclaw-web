-- Cleanup LinkedIn Sales Navigator references from active agent_assignments
-- Historical/completed records are preserved as-is
-- Run date: 2026-04-13

BEGIN;

-- 1. Remove LinkedIn-related blockers from active lead_prospecting agents
--    "Need LinkedIn Sales Navigator or Apollo.io access" → "Need Apollo.io access"
--    "需要 LinkedIn Sales Navigator 或 Apollo.io 访问权限" → "需要 Apollo.io 访问权限"
UPDATE agent_assignments
SET config = jsonb_set(
  config::jsonb,
  '{blockers}',
  (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN elem #>> '{}' = 'Need LinkedIn Sales Navigator or Apollo.io access'
          THEN '"Need Apollo.io access"'::jsonb
        WHEN elem #>> '{}' = '需要 LinkedIn Sales Navigator 或 Apollo.io 访问权限'
          THEN '"需要 Apollo.io 访问权限"'::jsonb
        ELSE elem
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(config::jsonb -> 'blockers') AS elem
  )
)
WHERE status = 'active'
  AND agent_type = 'lead_prospecting'
  AND config::text LIKE '%LinkedIn Sales Navigator%';

-- 2. Rename task "设置数据源（LinkedIn、Apollo 等）" → "设置数据源（Apollo 等）"
UPDATE agent_assignments
SET config = jsonb_set(
  config::jsonb,
  '{tasks}',
  (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN task ->> 'name' = '设置数据源（LinkedIn、Apollo 等）'
          THEN jsonb_set(task, '{name}', '"设置数据源（Apollo 等）"'::jsonb)
        ELSE task
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(config::jsonb -> 'tasks') AS task
  )
)
WHERE status = 'active'
  AND agent_type = 'lead_prospecting'
  AND config::text LIKE '%LinkedIn%Apollo%';

-- 3. Remove skillLinkedIn from user_skills first (FK dependency)
DELETE FROM user_skills WHERE skill_id IN (
  SELECT id FROM skills WHERE key = 'skillLinkedIn'
);

-- 4. Remove skillLinkedIn from skills table
DELETE FROM skills WHERE key = 'skillLinkedIn';

COMMIT;
