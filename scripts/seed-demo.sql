-- Seed demo data for the email automation workflow demo.
-- Idempotent: safe to re-run.
-- Assumes DATABASE_URL points at the local docker postgres (port 5433).

-- 1) Demo user + project (linked to Auth0 sub via email)
INSERT INTO users (email, name, plan)
VALUES ('mengchunjiang741112@gmail.com', 'Mengchun Jiang', 'scale')
ON CONFLICT DO NOTHING;

INSERT INTO projects (user_id, name, description, website)
SELECT u.id, 'US Pro Gloves – Q3 US Distributors',
       'Nitrile gloves outbound to US distributors, clinics, auto shops.',
       'https://usproglove.com'
FROM users u WHERE u.email = 'mengchunjiang741112@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.user_id = u.id AND p.name = 'US Pro Gloves – Q3 US Distributors'
  );

-- 2) Six follow-up email templates (cold, 3d, 7d, 30d, 90d, 365d)
WITH u AS (SELECT id FROM users WHERE email = 'mengchunjiang741112@gmail.com'),
     p AS (SELECT id FROM projects WHERE name = 'US Pro Gloves – Q3 US Distributors' LIMIT 1)
INSERT INTO email_templates (user_id, project_id, name, subject, body_html, language, category, is_ai_generated, tags)
SELECT u.id, p.id, v.name, v.subject, v.body_html, 'en', v.category, false, v.tags
FROM u, p, (VALUES
  ('Nitrile — first touch',
   'Quick question on your nitrile glove supply, {{first_name}}',
   '<p>Hi {{first_name}},</p><p>Saw {{company}} works in {{industry_tag}}. We''re US Pro Gloves — FDA 510(k) cleared nitrile, MOQ 10 cases, US-warehoused for 2-day delivery.</p><p>Worth a 10-min call to compare your current pricing?</p><p>— Mengchun</p>',
   'cold_outreach', ARRAY['first_touch','nitrile']),
  ('Nitrile — 3 day follow-up',
   'Re: {{company}} + US-warehoused nitrile',
   '<p>Hi {{first_name}},</p><p>Following up — many {{industry_tag}} buyers tell us their current supplier ran into China-side shipping delays last quarter. Our US warehouse means same-week delivery.</p><p>Want me to send a sample case? No charge.</p>',
   'follow_up', ARRAY['day_3','nitrile']),
  ('Nitrile — 7 day follow-up',
   'One last thought for {{company}}',
   '<p>Hi {{first_name}},</p><p>I''ll keep this brief. We help {{industry_tag}} cut nitrile spend ~15% on average without dropping quality. If pricing isn''t your bottleneck right now I understand — happy to circle back later in the year.</p><p>Either way, here''s our spec sheet: [link].</p>',
   'follow_up', ARRAY['day_7','nitrile']),
  ('Nitrile — 30 day follow-up',
   'Q3 nitrile pricing update — {{company}}',
   '<p>Hi {{first_name}},</p><p>Quick update: our Q3 pricing kicks in next week. {{industry_tag}} buyers locking in before then save another 5%.</p><p>Open to a 5-minute call?</p>',
   'follow_up', ARRAY['day_30','nitrile']),
  ('Nitrile — 90 day follow-up',
   'Has {{company}}''s nitrile situation changed?',
   '<p>Hi {{first_name}},</p><p>It''s been about a quarter — circumstances can shift fast in {{industry_tag}}. If your current supplier is still serving you well, no worries. If anything''s changed, I''m a reply away.</p>',
   'follow_up', ARRAY['day_90','nitrile']),
  ('Nitrile — annual check-in',
   '{{company}}: nitrile review for the new year',
   '<p>Hi {{first_name}},</p><p>It''s been a year. Many {{industry_tag}} operations re-bid their PPE supplier annually — happy to put a quick comparison together for {{company}} at no cost.</p><p>Let me know if useful.</p>',
   'follow_up', ARRAY['day_365','nitrile'])
) AS v(name, subject, body_html, category, tags)
WHERE NOT EXISTS (
  SELECT 1 FROM email_templates et WHERE et.user_id = u.id AND et.name = v.name
);

-- 3) Three demo contacts in the project
WITH u AS (SELECT id FROM users WHERE email = 'mengchunjiang741112@gmail.com'),
     p AS (SELECT id FROM projects WHERE name = 'US Pro Gloves – Q3 US Distributors' LIMIT 1)
INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, source, tags)
SELECT u.id, p.id, v.email, v.first_name, v.last_name, v.company, v.position, 'manual', v.tags
FROM u, p, (VALUES
  ('procurement@autoworksmidwest.com', 'James', 'Whitaker', 'AutoWorks Midwest', 'Procurement Manager', ARRAY['auto_detailing','midwest']),
  ('supplies@harborviewclinic.com',   'Linda', 'Park',     'Harborview Clinic',  'Operations Director', ARRAY['medical_clinic','west_coast']),
  ('buyer@grandviewautomotive.com',   'Marcus','Cole',     'Grandview Automotive','Buyer',              ARRAY['auto_dealership','northeast'])
) AS v(email, first_name, last_name, company, position, tags)
WHERE NOT EXISTS (
  SELECT 1 FROM contacts c WHERE c.user_id = u.id AND c.email = v.email
);

-- 4) Report seed counts
SELECT 'users' AS what, COUNT(*) FROM users WHERE email = 'mengchunjiang741112@gmail.com'
UNION ALL SELECT 'projects', COUNT(*) FROM projects WHERE name = 'US Pro Gloves – Q3 US Distributors'
UNION ALL SELECT 'templates', COUNT(*) FROM email_templates WHERE name LIKE 'Nitrile —%'
UNION ALL SELECT 'contacts', COUNT(*) FROM contacts WHERE email IN ('procurement@autoworksmidwest.com','supplies@harborviewclinic.com','buyer@grandviewautomotive.com');
