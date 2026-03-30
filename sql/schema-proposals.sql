-- ══════════════════════════════════════════
-- VSDR Proposal Lab — Supabase Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════

-- 1. Proposals table
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled Proposal',
  client_name TEXT,
  client_contact TEXT,
  proposal_type TEXT DEFAULT 'Full Proposal',
  proposal_index TEXT,
  slug TEXT,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','sent','archived')),
  share_token TEXT UNIQUE,
  cover_data JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_by TEXT DEFAULT 'gaby',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_share_token ON proposals(share_token);

-- 2. Proposal Sections table
CREATE TABLE IF NOT EXISTS proposal_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  content_type TEXT NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text','table','image','metrics','timeline','callout','divider','cover','pricing')),
  content TEXT,
  content_json JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','edited','change_requested','approved')),
  callout_text TEXT,
  callout_attribution TEXT,
  image_url TEXT,
  table_data JSONB,
  metrics_data JSONB,
  timeline_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sections_proposal ON proposal_sections(proposal_id);
CREATE INDEX IF NOT EXISTS idx_sections_order ON proposal_sections(proposal_id, sort_order);

-- 3. Proposal Change Requests table
CREATE TABLE IF NOT EXISTS proposal_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT 'Yousra',
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  resolved_by TEXT,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cr_section ON proposal_change_requests(section_id);
CREATE INDEX IF NOT EXISTS idx_cr_status ON proposal_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_cr_proposal ON proposal_change_requests(proposal_id);

-- 4. Row Level Security (allow reads from publishable key, writes too for now)
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on proposals" ON proposals FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE proposal_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on proposal_sections" ON proposal_sections FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE proposal_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on proposal_change_requests" ON proposal_change_requests FOR ALL USING (true) WITH CHECK (true);

-- 5. Seed NovaTech sample proposal
INSERT INTO proposals (id, title, client_name, client_contact, proposal_type, proposal_index, slug, description, status, metadata, created_at, updated_at)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Growth Partnership Proposal — NovaTech Ventures',
  'NovaTech Ventures',
  'Sarah Al-Rashid, Managing Partner',
  'Full Proposal',
  'SP-2026-001',
  'novatech-growth-2026',
  '12-month growth partnership for portfolio companies',
  'approved',
  '{"created_by":"gaby","version":2}',
  '2026-03-30T14:00:00Z',
  '2026-03-30T14:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- Seed sections for NovaTech
INSERT INTO proposal_sections (id, proposal_id, sort_order, title, content_type, content, callout_text, callout_attribution, status, metrics_data, timeline_data, table_data) VALUES
('11111111-1111-1111-1111-111111111101', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'Executive Summary', 'text',
 E'NovaTech Ventures is building the most ambitious deep-tech portfolio in the MENA region, with 23 companies across AI, climate-tech, and fintech. Your portfolio companies have strong technology but face a consistent gap: scaling revenue and building enterprise partnerships in North America and Europe.\n\nWe propose a 12-month Growth Partnership where Sprintly Partners embeds a dedicated growth squad within your portfolio, delivering hands-on market entry support, enterprise sales enablement, and Silicon Valley network access for your top 8 portfolio companies.\n\nExpected outcome: 40+ qualified enterprise pipeline opportunities, 3-5 signed partnerships, and a repeatable go-to-market playbook for each company within 12 months.',
 'The gap is not product quality — it is market access, positioning, and the right introductions at the right time.',
 'Sprintly Partners Thesis, 2026', 'approved', NULL, NULL, NULL),

('11111111-1111-1111-1111-111111111102', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2, 'Sprintly Track Record', 'metrics',
 NULL, NULL, NULL, 'approved',
 '[{"label":"Startups Scaled","value":"12","icon":"rocket","sub":"Cross-border in 2025"},{"label":"Follow-on Funding","value":"$47M","icon":"chart","sub":"Raised by portfolio"},{"label":"Funding Rate","value":"73%","icon":"target","sub":"MENA to Valley cohort"},{"label":"Enterprise Intros","value":"200+","icon":"network","sub":"Active network: 6,000+"}]',
 NULL, NULL),

('11111111-1111-1111-1111-111111111103', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3, 'The Opportunity', 'text',
 E'MENA deep-tech companies raised $2.1B in 2025 (+34% YoY). Only 12% establish recurring revenue outside the region within 3 years. The gap is not product quality. It is market access, positioning, and the right introductions at the right time.\n\nThree of your portfolio companies are raising Series A rounds in Q3 2026. International traction is the single strongest signal for global VCs.\n\nThe window is now. Companies that establish US/EU anchor customers before their Series A close at significantly higher valuations and with stronger syndicate interest.',
 NULL, NULL, 'approved', NULL, NULL, NULL),

('11111111-1111-1111-1111-111111111104', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 4, 'Our 4-Phase Methodology', 'text',
 E'Phase 1: Diagnostic and Selection (Weeks 1-3)\nAssess all 23 companies, score GTM readiness, select top 8, deliver detailed market entry reports for each.\n\nPhase 2: Positioning and Enablement (Weeks 4-8)\nRebuild positioning for global audiences, create enterprise sales collateral, build 400 target account lists, train founding teams on outbound motion.\n\nPhase 3: Market Activation (Weeks 9-36)\nExecute outreach campaigns, facilitate warm introductions from network, provide active deal support, organize 2 Silicon Valley trips with curated meetings.\n\nPhase 4: Measurement and Playbook (Weeks 37-48)\nCompile results, deliver reusable Growth Playbook per company, present full impact report to NovaTech investment committee.',
 NULL, NULL, 'approved', NULL, NULL, NULL),

('11111111-1111-1111-1111-111111111105', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 5, 'Engagement Timeline', 'timeline',
 NULL, NULL, NULL, 'approved', NULL,
 '[{"phase":"Diagnostic","weeks":"1-3","color":"#4ECB71"},{"phase":"Enablement","weeks":"4-8","color":"#2DD4BF"},{"phase":"Activation","weeks":"9-36","color":"#F59E0B"},{"phase":"Playbook","weeks":"37-48","color":"#EF4444"}]',
 NULL),

('11111111-1111-1111-1111-111111111106', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 6, 'Investment', 'pricing',
 NULL, NULL, NULL, 'approved', NULL, NULL,
 '{"headers":["","Pilot","Full Partnership (Rec.)","Sprint"],"recommended":"Full Partnership (Rec.)","rows":[["Companies","2","8","4"],["Duration","3 months","12 months","6 months"],["SV Trips","0","2","1"],["Investment","$90,000","$480,000","$280,000"],["Per Company","$45,000","$60,000 ($5K/mo)","$70,000"],["Payment","100% upfront","25% + quarterly","50/50"]]}'),

('11111111-1111-1111-1111-111111111107', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 7, 'Why Sprintly', 'text',
 E'Network depth, not breadth. Our 6,000+ contacts are relationships, not a database. Every intro is warm, every connection is pre-qualified.\n\nAI-powered operations. Our VSDR platform provides real-time pipeline tracking, smart matching, and automated contact enrichment.\n\nMENA-native, Silicon Valley-connected. We speak both languages — literally and culturally. We know what resonates with US VCs and enterprise buyers.\n\nProven playbook. Across 12 portfolio companies in 2025, we developed a repeatable GTM methodology that works specifically for MENA deep-tech in global markets.',
 'We do not advise. We execute. Sprintly operators work alongside your founders, not above them.',
 NULL, 'approved', NULL, NULL, NULL),

('11111111-1111-1111-1111-111111111108', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 8, 'Expected ROI', 'metrics',
 NULL, NULL, NULL, 'approved',
 '[{"label":"Conservative","value":"$2M+","sub":"30 pipeline opps\n2 signed partnerships\n20% follow-on lift"},{"label":"Target","value":"$5M+","sub":"40+ pipeline opps\n3-5 signed partnerships\n40% follow-on lift"},{"label":"Stretch","value":"$10M+","sub":"60+ pipeline opps\n7+ signed partnerships\n60% follow-on lift"}]',
 NULL, NULL),

('11111111-1111-1111-1111-111111111109', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 9, 'Next Steps', 'text',
 E'We propose a 45-minute call to walk through this proposal together and discuss which option fits NovaTech best.\n\nSuggested date: Week of April 7, 2026.\n\nTo schedule: Yousra Gaballah (yousra@sprintlypartners.com) or Gaby (gaby@sprintlypartners.com).\n\nThis proposal is valid until April 14, 2026.',
 NULL, NULL, 'approved', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- 6. Knowledge Base table
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT,
  source_id TEXT,
  source_url TEXT,
  folder_id TEXT,
  content TEXT,
  content_type TEXT,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_by TEXT DEFAULT 'gaby',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_source ON knowledge_base(source);
CREATE INDEX IF NOT EXISTS idx_kb_folder ON knowledge_base(folder_id);
CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_base(content_type);

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on knowledge_base" ON knowledge_base FOR ALL USING (true) WITH CHECK (true);

-- Drop the old vsdr_proposals table if migrating (CAREFUL - back up first!)
-- DROP TABLE IF EXISTS vsdr_proposals;
