-- ═══════ GoldenRay Energy — Seed Data ═══════

-- Passwords: bcrypt hash of the plaintext shown in comments
-- admin123 / manager123 / sales123 / proposal123
INSERT INTO users (id, name, email, password_hash, role, avatar) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'Aroha Mitchell',  'aroha@goldenray.co.nz',  '$2a$10$xJwL5FQZQqL1YB6J8V6KLe9P6CqYP3OxWQqJJvS/vQikmHxY1.xYa', 'admin',        'AM'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'Liam Patel',      'liam@goldenray.co.nz',   '$2a$10$xJwL5FQZQqL1YB6J8V6KLe9P6CqYP3OxWQqJJvS/vQikmHxY1.xYa', 'sales_mgr',    'LP'),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'Sophie Nguyen',   'sophie@goldenray.co.nz', '$2a$10$xJwL5FQZQqL1YB6J8V6KLe9P6CqYP3OxWQqJJvS/vQikmHxY1.xYa', 'sales_exec',   'SN'),
  ('a1a1a1a1-0000-0000-0000-000000000004', 'Jack Te Awa',     'jack@goldenray.co.nz',   '$2a$10$xJwL5FQZQqL1YB6J8V6KLe9P6CqYP3OxWQqJJvS/vQikmHxY1.xYa', 'proposal_mgr', 'JT');

INSERT INTO pipeline_stages (stage_key, label, color, sort_order) VALUES
  ('new',           'New',          '#6366f1', 1),
  ('qualified',     'Qualified',    '#8b5cf6', 2),
  ('survey',        'Survey',       '#a78bfa', 3),
  ('proposal_gen',  'Proposed',     '#f59e0b', 4),
  ('proposal_sent', 'Sent',         '#3b82f6', 5),
  ('followup',      'Follow-Up',    '#06b6d4', 6),
  ('negotiation',   'Negotiating',  '#f97316', 7),
  ('won',           'Won',          '#10b981', 8),
  ('lost',          'Lost',         '#ef4444', 9);

INSERT INTO companies (id, name, domain, industry, size, city, annual_revenue, owner_id, lifecycle) VALUES
  ('c0c0c0c0-0000-0000-0000-000000000001', 'Pacific Fresh Ltd',      'pacificfresh.co.nz', 'Food & Beverage', '50-200',  'Christchurch', '$8M',  'a1a1a1a1-0000-0000-0000-000000000002', 'opportunity'),
  ('c0c0c0c0-0000-0000-0000-000000000002', 'Kiwi Dairy Co-op',       'kiwidairy.co.nz',    'Agriculture',     '200-500', 'Hamilton',     '$22M', 'a1a1a1a1-0000-0000-0000-000000000002', 'customer'),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'Rawiri Hotels Group',    'rawirihotels.co.nz', 'Hospitality',     '200-500', 'Queenstown',   '$15M', 'a1a1a1a1-0000-0000-0000-000000000002', 'customer'),
  ('c0c0c0c0-0000-0000-0000-000000000004', 'NZ Greens Produce',      'nzgreens.co.nz',     'Agriculture',     '50-200',  'Napier',       '$5M',  'a1a1a1a1-0000-0000-0000-000000000002', 'opportunity'),
  ('c0c0c0c0-0000-0000-0000-000000000005', 'Southern Cross Winery',  'scwinery.co.nz',     'Wine & Spirits',  '50-200',  'Marlborough',  '$12M', 'a1a1a1a1-0000-0000-0000-000000000002', 'sql');

INSERT INTO contacts (name, email, phone, type, system_type, location, monthly_bill, stage, source, assigned_to, company_id, estimated_value, lifecycle, lead_score, notes) VALUES
  ('Te Whiti Ngata',       'tewhiti@xtra.co.nz',       '+64 21 555 001', 'residential', 'on-grid',  'Auckland',      280,   'proposal_sent', 'website',  'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   14200,  'opportunity', 72,  'South-facing roof, great install conditions.'),
  ('Pacific Fresh Ltd',    'ops@pacificfresh.co.nz',   '+64 9 555 002',  'commercial',  'hybrid',   'Christchurch',  4800,  'negotiation',   'referral', 'a1a1a1a1-0000-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000001', 185000, 'opportunity', 88,  'Board reviewing revised pricing.'),
  ('Hannah Brown',         'hannah@gmail.com',          '+64 27 555 003', 'residential', 'off-grid', 'Queenstown',    350,   'qualified',     'ad',       'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   21000,  'lead',        54,  'Off-grid cabin, summer use only.'),
  ('James Wilson',         'wilson@outlook.co.nz',     '+64 22 555 004', 'residential', 'on-grid',  'Wellington',    320,   'won',           'website',  'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   16500,  'customer',    95,  'Installation complete, very satisfied.'),
  ('Kiwi Dairy Co-op',     'admin@kiwidairy.co.nz',    '+64 7 555 005',  'commercial',  'on-grid',  'Hamilton',      8200,  'won',           'walk-in',  'a1a1a1a1-0000-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000002', 245000, 'customer',    98,  '218 panels commissioned, exporting to grid.'),
  ('Aroha Tuhoe',          'aroha.tuhoe@gmail.com',    '+64 21 555 006', 'residential', 'hybrid',   'Tauranga',      260,   'new',           'website',  NULL,                                   NULL,                                   18500,  'subscriber',  22,  'Initial interest via calculator form.'),
  ('Rawiri Hotels Group',  'ops@rawirihotels.co.nz',   '+64 3 555 007',  'commercial',  'on-grid',  'Queenstown',    12000, 'won',           'referral', 'a1a1a1a1-0000-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000003', 320000, 'customer',    96,  'Full resort installation complete.'),
  ('Linda Garcia',         'linda@proton.me',           '+64 22 555 008', 'residential', 'on-grid',  'Nelson',        410,   'followup',      'referral', 'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   26800,  'mql',         64,  'Competing with one other quote.'),
  ('NZ Greens Produce',    'farm@nzgreens.co.nz',      '+64 6 555 009',  'commercial',  'hybrid',   'Napier',        6500,  'proposal_gen',  'ad',       'a1a1a1a1-0000-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000004', 198000, 'sql',         75,  'Board presentation next Tuesday.'),
  ('Sam Chen',             'samchen@gmail.com',         '+64 21 555 010', 'residential', 'on-grid',  'Auckland',      290,   'lost',          'website',  'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   15200,  'other',       12,  'Lost to competitor on price by $1,200.'),
  ('Southern Cross Winery','ops@scwinery.co.nz',       '+64 3 555 011',  'commercial',  'on-grid',  'Marlborough',   7800,  'survey',        'referral', 'a1a1a1a1-0000-0000-0000-000000000002', 'c0c0c0c0-0000-0000-0000-000000000005', 210000, 'sql',         81,  'Drone survey complete, report pending.'),
  ('Ngaio Harper',         'ngaio@outlook.co.nz',      '+64 4 555 012',  'residential', 'hybrid',   'Wellington',    380,   'won',           'website',  'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   24500,  'customer',    94,  '90-day check-in scheduled.'),
  ('Tama Ropata',          'tama@xtra.co.nz',          '+64 21 555 013', 'residential', 'on-grid',  'Rotorua',       310,   'new',           'ad',       'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   15800,  'subscriber',  18,  NULL),
  ('Eden Park Sports Club','admin@edenpark.co.nz',     '+64 9 555 014',  'commercial',  'on-grid',  'Auckland',      9400,  'qualified',     'referral', 'a1a1a1a1-0000-0000-0000-000000000002', NULL,                                   275000, 'mql',         60,  'Large flat roof — ideal commercial install.'),
  ('Mere Taiapa',          'mere.t@gmail.com',          '+64 27 555 015', 'residential', 'hybrid',   'Gisborne',      295,   'proposal_sent', 'website',  'a1a1a1a1-0000-0000-0000-000000000003', NULL,                                   19200,  'opportunity', 70,  'Proposal emailed, awaiting decision.');

INSERT INTO campaigns (name, type, status, channel, budget, spent, emails_sent, emails_opened, emails_clicked, emails_bounced, unsubscribed, leads_generated, conversions, revenue_attributed) VALUES
  ('Summer Solar Blitz',        'email',    'active',    'email',      4500,  3820, 2400, 1080, 312, 48, 12, 48, 6,  156000),
  ('Google Ads — Residential',  'paid',     'active',    'google_ads', 12000, 4200,    0,    0,   0,  0,  0, 34, 4,   72200),
  ('Facebook Solar Awareness',  'paid',     'active',    'facebook',   6000,  2800,    0,    0,   0,  0,  0, 22, 2,   39500),
  ('Commercial Outreach Q1',    'email',    'completed', 'email',      1200,  1200,  800,  384,  96, 16,  4, 12, 3,  653000),
  ('Green Business Webinar',    'event',    'completed', 'event',      2000,  1850,    0,    0,   0,  0,  0, 28, 1,  210000),
  ('Referral Bonus Program',    'referral', 'active',    'referral',   8000,  3200,    0,    0,   0,  0,  0, 18, 5,  597300),
  ('LinkedIn B2B Targeting',    'paid',     'active',    'linkedin',   9000,  2100,    0,    0,   0,  0,  0,  8, 1,  198000),
  ('Autumn Newsletter Series',  'email',    'active',    'email',       800,   320, 1800,  756, 198, 36,  8,  6, 0,       0);

INSERT INTO system_config (key, value) VALUES
  ('solar_pricing', '{"costPerKw":1850,"batteryCostPerKwh":890,"taxRate":15,"markup":12,"defaultElecRate":0.32,"laborPct":18,"panelWatts":550,"sunHours":4.5,"inverterPct":14}'),
  ('company_info',  '{"name":"GoldenRay Energy","email":"hello@goldenrayenergy.co.nz","phone":"+64 21 839 356","address":"Level 3, 45 Queen St, Auckland"}');

-- ── Deals ──
INSERT INTO deals (name, contact_id, company_id, amount, stage, owner_id, close_date, deal_type, priority, probability, notes) VALUES
  ('Te Whiti Ngata — 8kW On-Grid Auckland',
    (SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'), NULL,
    14200, 'proposal', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-04-30', 'New Business', 'high', 65, 'Proposal sent. Customer reviewing pricing options.'),

  ('Pacific Fresh Ltd — 95kW Hybrid System',
    (SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'), 'c0c0c0c0-0000-0000-0000-000000000001',
    185000, 'negotiation', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-05-15', 'New Business', 'high', 80, 'Board requesting 8% discount. Countering with 3% + free monitoring.'),

  ('Hannah Brown — 12kW Off-Grid Cabin',
    (SELECT id FROM contacts WHERE email='hannah@gmail.com'), NULL,
    21000, 'qualified', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-05-20', 'New Business', 'medium', 40, 'Site survey booked. Queenstown cabin, summer use.'),

  ('James Wilson — 7kW On-Grid Wellington',
    (SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'), NULL,
    16500, 'closed_won', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-03-15', 'New Business', 'medium', 100, 'Installation complete. Customer very satisfied.'),

  ('Kiwi Dairy Co-op — 180kW On-Grid Hamilton',
    (SELECT id FROM contacts WHERE email='admin@kiwidairy.co.nz'), 'c0c0c0c0-0000-0000-0000-000000000002',
    245000, 'closed_won', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-02-28', 'New Business', 'high', 100, '218 panels commissioned. Grid export approved.'),

  ('Aroha Tuhoe — 9kW Hybrid Tauranga',
    (SELECT id FROM contacts WHERE email='aroha.tuhoe@gmail.com'), NULL,
    18500, 'appointment', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-05-30', 'New Business', 'low', 20, 'Initial enquiry via website form. Site visit to book.'),

  ('Rawiri Hotels — 250kW Queenstown Resort',
    (SELECT id FROM contacts WHERE email='ops@rawirihotels.co.nz'), 'c0c0c0c0-0000-0000-0000-000000000003',
    320000, 'closed_won', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-01-20', 'New Business', 'high', 100, 'Main building + spa block. Generating 15% above forecast.'),

  ('Linda Garcia — 14kW On-Grid Nelson',
    (SELECT id FROM contacts WHERE email='linda@proton.me'), NULL,
    26800, 'qualified', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-05-10', 'New Business', 'medium', 50, 'One competing quote. Following up this week.'),

  ('NZ Greens Produce — 110kW Hybrid Farm',
    (SELECT id FROM contacts WHERE email='farm@nzgreens.co.nz'), 'c0c0c0c0-0000-0000-0000-000000000004',
    198000, 'presentation', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-05-25', 'New Business', 'high', 60, 'Board presentation scheduled. ROI slide deck sent.'),

  ('Sam Chen — 6kW On-Grid Auckland',
    (SELECT id FROM contacts WHERE email='samchen@gmail.com'), NULL,
    15200, 'closed_lost', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-03-01', 'New Business', 'low', 0, 'Lost to competitor. Price $1,200 lower.'),

  ('Southern Cross Winery — 140kW On-Grid Marlborough',
    (SELECT id FROM contacts WHERE email='ops@scwinery.co.nz'), 'c0c0c0c0-0000-0000-0000-000000000005',
    210000, 'appointment', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-06-01', 'New Business', 'high', 35, 'Drone survey done. Awaiting shading analysis report.'),

  ('Ngaio Harper — 11kW Hybrid Wellington',
    (SELECT id FROM contacts WHERE email='ngaio@outlook.co.nz'), NULL,
    24500, 'closed_won', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-02-10', 'New Business', 'medium', 100, 'System commissioned. Battery performing above spec.'),

  ('Eden Park Sports Club — 200kW Commercial Auckland',
    (SELECT id FROM contacts WHERE email='admin@edenpark.co.nz'), NULL,
    275000, 'qualified', (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    '2026-06-15', 'New Business', 'high', 45, 'Large flat roof. Council consent in progress.'),

  ('Mere Taiapa — 9kW Hybrid Gisborne',
    (SELECT id FROM contacts WHERE email='mere.t@gmail.com'), NULL,
    19200, 'proposal', (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    '2026-05-05', 'New Business', 'medium', 55, 'Proposal emailed. Waiting on response.');

-- ── Tasks ──
INSERT INTO tasks (title, description, assignee_id, contact_id, deal_id, due_date, priority, status, task_type) VALUES
  ('Follow-up call — Te Whiti Ngata proposal',
    'Check if customer has reviewed the proposal. Answer any pricing questions.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Te Whiti Ngata%' LIMIT 1),
    '2026-04-22', 'high', 'in_progress', 'call'),

  ('Price negotiation meeting — Pacific Fresh Ltd',
    'Prepare revised pricing with 3% discount + free monitoring counter-offer.',
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Pacific Fresh%' LIMIT 1),
    '2026-04-23', 'high', 'todo', 'meeting'),

  ('Book rooftop survey — Hannah Brown',
    'Schedule rooftop assessment. Bring drone for aerial shots. Off-grid cabin check.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='hannah@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Hannah Brown%' LIMIT 1),
    '2026-04-24', 'medium', 'todo', 'survey'),

  ('Send maintenance guide — James Wilson',
    'Email annual maintenance schedule, warranty documents, and monitoring app link.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'),
    NULL, '2026-04-21', 'low', 'todo', 'email'),

  ('Board presentation prep — NZ Greens Produce',
    'Finalise ROI analysis, CO2 impact, and government incentive slides.',
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='farm@nzgreens.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'NZ Greens%' LIMIT 1),
    '2026-04-25', 'high', 'in_progress', 'proposal'),

  ('Competitive follow-up — Linda Garcia',
    'Customer received competitor quote. Emphasise 25-yr warranty and local support team.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='linda@proton.me'),
    (SELECT id FROM deals WHERE name LIKE 'Linda Garcia%' LIMIT 1),
    '2026-04-22', 'medium', 'todo', 'call'),

  ('Compile survey report — Southern Cross Winery',
    'Write up drone imagery and shading analysis. Send PDF to client.',
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='ops@scwinery.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Southern Cross Winery%' LIMIT 1),
    '2026-04-28', 'high', 'todo', 'report'),

  ('Initial site visit — Aroha Tuhoe',
    'Introduce GoldenRay. Assess roof, understand energy needs, demo monitoring app.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='aroha.tuhoe@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Aroha Tuhoe%' LIMIT 1),
    '2026-04-20', 'medium', 'overdue', 'meeting'),

  ('Generate hybrid proposal — Aroha Tuhoe',
    'Run system calculator for 9kW hybrid. Include battery backup sizing.',
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='aroha.tuhoe@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Aroha Tuhoe%' LIMIT 1),
    '2026-04-29', 'medium', 'todo', 'proposal'),

  ('Submit grid connection paperwork — Kiwi Dairy Co-op',
    'Lodge final MCS and grid export certification with local authority.',
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='admin@kiwidairy.co.nz'),
    NULL, '2026-04-15', 'low', 'completed', 'admin'),

  ('Review commissioning photos — Rawiri Hotels',
    'Quality-check install photos before sending sign-off pack to client.',
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='ops@rawirihotels.co.nz'),
    NULL, '2026-03-01', 'medium', 'completed', 'review'),

  ('90-day performance check-in — Ngaio Harper',
    'Schedule 90-day performance review. Share dashboard and savings summary.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='ngaio@outlook.co.nz'),
    NULL, '2026-05-10', 'low', 'todo', 'call'),

  ('Council consent application — Eden Park Sports Club',
    'Prepare and submit consent documents. Include structural loading report.',
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='admin@edenpark.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Eden Park%' LIMIT 1),
    '2026-05-01', 'high', 'todo', 'admin'),

  ('Follow-up on proposal — Mere Taiapa',
    'No response after 5 days. Call to check if proposal was received clearly.',
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    (SELECT id FROM contacts WHERE email='mere.t@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Mere Taiapa%' LIMIT 1),
    '2026-04-26', 'medium', 'todo', 'call'),

  ('Import new leads — Summer Solar Blitz campaign',
    'Pull form submissions from website, deduplicate, and assign to Sophie.',
    (SELECT id FROM users WHERE email='aroha@goldenray.co.nz'),
    NULL, NULL, '2026-04-21', 'medium', 'todo', 'admin'),

  ('Quarterly revenue report — April 2026',
    'Compile closed deals, pipeline value, conversion rates for board meeting.',
    (SELECT id FROM users WHERE email='aroha@goldenray.co.nz'),
    NULL, NULL, '2026-04-30', 'high', 'todo', 'report');

-- ── Activities ──
INSERT INTO activities (type, description, contact_id, deal_id, user_id, duration_minutes, outcome, created_at) VALUES
  ('call',
    'Initial enquiry call. $280/month bill. Interested in 8kW on-grid system. South-facing roof confirmed.',
    (SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Te Whiti Ngata%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    18, 'interested', NOW() - INTERVAL '14 days'),

  ('meeting',
    'Site visit complete. Minimal shading. Roof in great condition. 14-panel layout confirmed.',
    (SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Te Whiti Ngata%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    90, 'positive', NOW() - INTERVAL '7 days'),

  ('email',
    'Proposal sent — 8kW system, 14 panels, $14,200 incl. GST. PDF attached.',
    (SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Te Whiti Ngata%' LIMIT 1),
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    10, 'sent', NOW() - INTERVAL '3 days'),

  ('call',
    'Commercial enquiry from operations manager. Factory runs 24/7 — huge savings potential identified.',
    (SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Pacific Fresh%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    25, 'interested', NOW() - INTERVAL '30 days'),

  ('meeting',
    'Board presentation — 95kW hybrid design. $185k total, 4.0yr payback, $46k/yr savings.',
    (SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Pacific Fresh%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    120, 'positive', NOW() - INTERVAL '10 days'),

  ('call',
    'Negotiation call — board wants 8% discount. Countered with 3% + free 5yr monitoring subscription.',
    (SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Pacific Fresh%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    35, 'negotiating', NOW() - INTERVAL '2 days'),

  ('call',
    'Customer wants fully off-grid system for Queenstown cabin. 3 bed, summer use only.',
    (SELECT id FROM contacts WHERE email='hannah@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Hannah Brown%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    22, 'interested', NOW() - INTERVAL '18 days'),

  ('call',
    'Standard residential enquiry via website. Wellington suburb, 7kW on-grid suits usage well.',
    (SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'James Wilson%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    20, 'interested', NOW() - INTERVAL '60 days'),

  ('meeting',
    'Site visit — 7kW layout confirmed. Wellington wind assessed — standard fittings sufficient.',
    (SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'James Wilson%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    75, 'positive', NOW() - INTERVAL '50 days'),

  ('note',
    'Contract signed and 50% deposit received. Installation scheduled 10 March.',
    (SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'James Wilson%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    0, NULL, NOW() - INTERVAL '45 days'),

  ('meeting',
    'Technical scoping with engineering team — 180kW on-grid design finalised. Single-axis mounting.',
    (SELECT id FROM contacts WHERE email='admin@kiwidairy.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Kiwi Dairy%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    180, 'positive', NOW() - INTERVAL '90 days'),

  ('note',
    'Full installation complete — 218 panels. Grid export approved. First bill shows 78% reduction.',
    (SELECT id FROM contacts WHERE email='admin@kiwidairy.co.nz'),
    NULL,
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    0, NULL, NOW() - INTERVAL '50 days'),

  ('call',
    'Referral from James Wilson. Large Nelson property. Interested in 14kW with battery option.',
    (SELECT id FROM contacts WHERE email='linda@proton.me'),
    (SELECT id FROM deals WHERE name LIKE 'Linda Garcia%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    30, 'interested', NOW() - INTERVAL '12 days'),

  ('email',
    'Detailed proposal sent with 25-yr savings projection, CO2 impact, and financing options.',
    (SELECT id FROM contacts WHERE email='linda@proton.me'),
    (SELECT id FROM deals WHERE name LIKE 'Linda Garcia%' LIMIT 1),
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    15, 'sent', NOW() - INTERVAL '5 days'),

  ('meeting',
    'Preliminary scoping — 110kW hybrid. Large barn roof ideal. Battery sized for overnight irrigation.',
    (SELECT id FROM contacts WHERE email='farm@nzgreens.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'NZ Greens%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    90, 'positive', NOW() - INTERVAL '20 days'),

  ('email',
    'Board-ready deck sent — ROI model, govt rebates, flexible finance, CO2 impact chart.',
    (SELECT id FROM contacts WHERE email='farm@nzgreens.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'NZ Greens%' LIMIT 1),
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    20, 'sent', NOW() - INTERVAL '3 days'),

  ('call',
    'Customer rang to say they chose competitor — price was $1,200 cheaper. Feedback noted.',
    (SELECT id FROM contacts WHERE email='samchen@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Sam Chen%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    10, 'lost', NOW() - INTERVAL '35 days'),

  ('meeting',
    'Kick-off — 250kW across main building and spa block. Contract signed for $320k.',
    (SELECT id FROM contacts WHERE email='ops@rawirihotels.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Rawiri Hotels%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    150, 'positive', NOW() - INTERVAL '120 days'),

  ('note',
    'Commissioning complete. System generating 15% above forecast. Client posted 5-star review.',
    (SELECT id FROM contacts WHERE email='ops@rawirihotels.co.nz'),
    NULL,
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    0, NULL, NOW() - INTERVAL '60 days'),

  ('call',
    'Inbound referral from Kiwi Dairy. Winery needs large commercial system for off-peak storage.',
    (SELECT id FROM contacts WHERE email='ops@scwinery.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Southern Cross Winery%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    28, 'interested', NOW() - INTERVAL '15 days'),

  ('call',
    'Hybrid system enquiry. Wants battery backup for Wellington winter outages.',
    (SELECT id FROM contacts WHERE email='ngaio@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Ngaio Harper%' LIMIT 1),
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    20, 'interested', NOW() - INTERVAL '80 days'),

  ('note',
    'Installation and commissioning complete. Battery providing full overnight cover. Customer thrilled.',
    (SELECT id FROM contacts WHERE email='ngaio@outlook.co.nz'),
    NULL,
    (SELECT id FROM users WHERE email='sophie@goldenray.co.nz'),
    0, NULL, NOW() - INTERVAL '55 days'),

  ('call',
    'Initial enquiry — 200kW commercial system for sports stadium. Large flat roof, ideal conditions.',
    (SELECT id FROM contacts WHERE email='admin@edenpark.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Eden Park%' LIMIT 1),
    (SELECT id FROM users WHERE email='liam@goldenray.co.nz'),
    40, 'interested', NOW() - INTERVAL '8 days'),

  ('email',
    'Sent proposal with full technical spec, ROI model, and council consent checklist.',
    (SELECT id FROM contacts WHERE email='mere.t@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Mere Taiapa%' LIMIT 1),
    (SELECT id FROM users WHERE email='jack@goldenray.co.nz'),
    12, 'sent', NOW() - INTERVAL '5 days');

-- ── Proposals ──
INSERT INTO proposals (contact_id, deal_id, system_size_kw, panel_count, battery_kwh, total_cost, monthly_savings, annual_savings, payback_years, roi_percent, co2_tons_year, status, sent_at) VALUES
  ((SELECT id FROM contacts WHERE email='tewhiti@xtra.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Te Whiti Ngata%' LIMIT 1),
    8.0, 14, 0, 14200, 217, 2604, 5.5, 280, 2.1, 'sent', NOW() - INTERVAL '3 days'),

  ((SELECT id FROM contacts WHERE email='ops@pacificfresh.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Pacific Fresh%' LIMIT 1),
    95.0, 172, 30, 185000, 3840, 46080, 4.0, 355, 24.8, 'viewed', NOW() - INTERVAL '8 days'),

  ((SELECT id FROM contacts WHERE email='wilson@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'James Wilson%' LIMIT 1),
    7.0, 13, 0, 16500, 251, 3012, 5.5, 270, 1.8, 'accepted', NOW() - INTERVAL '48 days'),

  ((SELECT id FROM contacts WHERE email='admin@kiwidairy.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Kiwi Dairy%' LIMIT 1),
    180.0, 327, 0, 245000, 6560, 78720, 3.1, 420, 47.0, 'accepted', NOW() - INTERVAL '88 days'),

  ((SELECT id FROM contacts WHERE email='ops@rawirihotels.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Rawiri Hotels%' LIMIT 1),
    250.0, 454, 0, 320000, 9600, 115200, 2.8, 460, 65.2, 'accepted', NOW() - INTERVAL '118 days'),

  ((SELECT id FROM contacts WHERE email='ngaio@outlook.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'Ngaio Harper%' LIMIT 1),
    11.0, 20, 10, 24500, 370, 4440, 5.5, 265, 2.9, 'accepted', NOW() - INTERVAL '78 days'),

  ((SELECT id FROM contacts WHERE email='linda@proton.me'),
    (SELECT id FROM deals WHERE name LIKE 'Linda Garcia%' LIMIT 1),
    14.0, 25, 0, 26800, 431, 5172, 5.2, 285, 3.7, 'sent', NOW() - INTERVAL '5 days'),

  ((SELECT id FROM contacts WHERE email='farm@nzgreens.co.nz'),
    (SELECT id FROM deals WHERE name LIKE 'NZ Greens%' LIMIT 1),
    110.0, 200, 20, 198000, 5200, 62400, 3.2, 395, 28.8, 'draft', NULL),

  ((SELECT id FROM contacts WHERE email='mere.t@gmail.com'),
    (SELECT id FROM deals WHERE name LIKE 'Mere Taiapa%' LIMIT 1),
    9.0, 16, 10, 19200, 291, 3492, 5.5, 270, 2.4, 'sent', NOW() - INTERVAL '5 days');
