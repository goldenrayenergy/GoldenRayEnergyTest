import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

async function clear() {
  console.log('🧹 Clearing existing data...');
  const byId  = ['activities','proposals','tasks','deals','contacts','campaigns','companies','pipeline_stages','users'];
  const byKey = ['system_config'];
  for (const t of byId)  await sb.from(t).delete().not('id',  'is', null);
  for (const t of byKey) await sb.from(t).delete().not('key', 'is', null);
  console.log('✅ Tables cleared\n');
}

async function ins(table, rows, label) {
  const { data, error } = await sb.from(table).insert(rows).select();
  if (error) throw new Error(`[${label}] ${error.message} — ${error.details || ''}`);
  console.log(`  ✅ ${label}: ${data.length} rows`);
  return data;
}

async function seed() {
  console.log('\n🌱 GoldenRay Energy — Seeding employee portal\n');

  const [adminH, mgrH, salesH, propH] = await Promise.all([
    bcrypt.hash('admin123',    10),
    bcrypt.hash('manager123',  10),
    bcrypt.hash('sales123',    10),
    bcrypt.hash('proposal123', 10),
  ]);

  await clear();
  console.log('Inserting data...');

  // ── Users ──────────────────────────────────────────────────────────────────
  const users = await ins('users', [
    { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'Aroha Mitchell', email: 'aroha@goldenray.co.nz',  password_hash: adminH, role: 'admin',        avatar: 'AM' },
    { id: 'a1a1a1a1-0000-0000-0000-000000000002', name: 'Liam Patel',     email: 'liam@goldenray.co.nz',   password_hash: mgrH,   role: 'sales_mgr',    avatar: 'LP' },
    { id: 'a1a1a1a1-0000-0000-0000-000000000003', name: 'Sophie Nguyen',  email: 'sophie@goldenray.co.nz', password_hash: salesH, role: 'sales_exec',   avatar: 'SN' },
    { id: 'a1a1a1a1-0000-0000-0000-000000000004', name: 'Jack Te Awa',    email: 'jack@goldenray.co.nz',   password_hash: propH,  role: 'proposal_mgr', avatar: 'JT' },
  ], 'Users');
  const u = Object.fromEntries(users.map(x => [x.email, x.id]));

  // ── Pipeline Stages ────────────────────────────────────────────────────────
  await ins('pipeline_stages', [
    { stage_key: 'new',           label: 'New',         color: '#6366f1', sort_order: 1 },
    { stage_key: 'qualified',     label: 'Qualified',   color: '#8b5cf6', sort_order: 2 },
    { stage_key: 'survey',        label: 'Survey',      color: '#a78bfa', sort_order: 3 },
    { stage_key: 'proposal_gen',  label: 'Proposed',    color: '#f59e0b', sort_order: 4 },
    { stage_key: 'proposal_sent', label: 'Sent',        color: '#3b82f6', sort_order: 5 },
    { stage_key: 'followup',      label: 'Follow-Up',   color: '#06b6d4', sort_order: 6 },
    { stage_key: 'negotiation',   label: 'Negotiating', color: '#f97316', sort_order: 7 },
    { stage_key: 'won',           label: 'Won',         color: '#10b981', sort_order: 8 },
    { stage_key: 'lost',          label: 'Lost',        color: '#ef4444', sort_order: 9 },
  ], 'Pipeline Stages');

  // ── Companies ──────────────────────────────────────────────────────────────
  await ins('companies', [
    { id: 'c0c0c0c0-0000-0000-0000-000000000001', name: 'Pacific Fresh Ltd',     domain: 'pacificfresh.co.nz', industry: 'Food & Beverage', size: '50-200',  city: 'Christchurch', annual_revenue: '$8M',  owner_id: u['liam@goldenray.co.nz'], lifecycle: 'opportunity' },
    { id: 'c0c0c0c0-0000-0000-0000-000000000002', name: 'Kiwi Dairy Co-op',      domain: 'kiwidairy.co.nz',    industry: 'Agriculture',     size: '200-500', city: 'Hamilton',     annual_revenue: '$22M', owner_id: u['liam@goldenray.co.nz'], lifecycle: 'customer'    },
    { id: 'c0c0c0c0-0000-0000-0000-000000000003', name: 'Rawiri Hotels Group',   domain: 'rawirihotels.co.nz', industry: 'Hospitality',     size: '200-500', city: 'Queenstown',   annual_revenue: '$15M', owner_id: u['liam@goldenray.co.nz'], lifecycle: 'customer'    },
    { id: 'c0c0c0c0-0000-0000-0000-000000000004', name: 'NZ Greens Produce',     domain: 'nzgreens.co.nz',     industry: 'Agriculture',     size: '50-200',  city: 'Napier',       annual_revenue: '$5M',  owner_id: u['liam@goldenray.co.nz'], lifecycle: 'opportunity' },
    { id: 'c0c0c0c0-0000-0000-0000-000000000005', name: 'Southern Cross Winery', domain: 'scwinery.co.nz',     industry: 'Wine & Spirits',  size: '50-200',  city: 'Marlborough',  annual_revenue: '$12M', owner_id: u['liam@goldenray.co.nz'], lifecycle: 'sql'         },
  ], 'Companies');

  // ── Contacts ───────────────────────────────────────────────────────────────
  const contacts = await ins('contacts', [
    { name: 'Te Whiti Ngata',        email: 'tewhiti@xtra.co.nz',      phone: '+64 21 555 001', type: 'residential', system_type: 'on-grid',  location: 'Auckland',     monthly_bill: 280,   stage: 'proposal_sent', source: 'website',  assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 14200,  lifecycle: 'opportunity', lead_score: 72, notes: 'South-facing roof, great install conditions.'  },
    { name: 'Pacific Fresh Ltd',     email: 'ops@pacificfresh.co.nz',  phone: '+64 9 555 002',  type: 'commercial',  system_type: 'hybrid',   location: 'Christchurch', monthly_bill: 4800,  stage: 'negotiation',   source: 'referral', assigned_to: u['liam@goldenray.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000001', estimated_value: 185000, lifecycle: 'opportunity', lead_score: 88, notes: 'Board reviewing revised pricing.'              },
    { name: 'Hannah Brown',          email: 'hannah@gmail.com',         phone: '+64 27 555 003', type: 'residential', system_type: 'off-grid', location: 'Queenstown',   monthly_bill: 350,   stage: 'qualified',     source: 'ad',       assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 21000,  lifecycle: 'lead',        lead_score: 54, notes: 'Off-grid cabin, summer use only.'              },
    { name: 'James Wilson',          email: 'wilson@outlook.co.nz',    phone: '+64 22 555 004', type: 'residential', system_type: 'on-grid',  location: 'Wellington',   monthly_bill: 320,   stage: 'won',           source: 'website',  assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 16500,  lifecycle: 'customer',    lead_score: 95, notes: 'Installation complete, very satisfied.'        },
    { name: 'Kiwi Dairy Co-op',      email: 'admin@kiwidairy.co.nz',   phone: '+64 7 555 005',  type: 'commercial',  system_type: 'on-grid',  location: 'Hamilton',     monthly_bill: 8200,  stage: 'won',           source: 'walk-in',  assigned_to: u['liam@goldenray.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000002', estimated_value: 245000, lifecycle: 'customer',    lead_score: 98, notes: '218 panels commissioned, exporting to grid.'   },
    { name: 'Aroha Tuhoe',           email: 'aroha.tuhoe@gmail.com',   phone: '+64 21 555 006', type: 'residential', system_type: 'hybrid',   location: 'Tauranga',     monthly_bill: 260,   stage: 'new',           source: 'website',  assigned_to: null,                        company_id: null,                                  estimated_value: 18500,  lifecycle: 'subscriber',  lead_score: 22, notes: 'Initial interest via calculator form.'         },
    { name: 'Rawiri Hotels Group',   email: 'ops@rawirihotels.co.nz',  phone: '+64 3 555 007',  type: 'commercial',  system_type: 'on-grid',  location: 'Queenstown',   monthly_bill: 12000, stage: 'won',           source: 'referral', assigned_to: u['liam@goldenray.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000003', estimated_value: 320000, lifecycle: 'customer',    lead_score: 96, notes: 'Full resort installation complete.'            },
    { name: 'Linda Garcia',          email: 'linda@proton.me',          phone: '+64 22 555 008', type: 'residential', system_type: 'on-grid',  location: 'Nelson',       monthly_bill: 410,   stage: 'followup',      source: 'referral', assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 26800,  lifecycle: 'mql',         lead_score: 64, notes: 'Competing with one other quote.'               },
    { name: 'NZ Greens Produce',     email: 'farm@nzgreens.co.nz',     phone: '+64 6 555 009',  type: 'commercial',  system_type: 'hybrid',   location: 'Napier',       monthly_bill: 6500,  stage: 'proposal_gen',  source: 'ad',       assigned_to: u['liam@goldenray.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000004', estimated_value: 198000, lifecycle: 'sql',         lead_score: 75, notes: 'Board presentation next Tuesday.'              },
    { name: 'Sam Chen',              email: 'samchen@gmail.com',        phone: '+64 21 555 010', type: 'residential', system_type: 'on-grid',  location: 'Auckland',     monthly_bill: 290,   stage: 'lost',          source: 'website',  assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 15200,  lifecycle: 'other',       lead_score: 12, notes: 'Lost to competitor on price by $1,200.'        },
    { name: 'Southern Cross Winery', email: 'ops@scwinery.co.nz',      phone: '+64 3 555 011',  type: 'commercial',  system_type: 'on-grid',  location: 'Marlborough',  monthly_bill: 7800,  stage: 'survey',        source: 'referral', assigned_to: u['liam@goldenray.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000005', estimated_value: 210000, lifecycle: 'sql',         lead_score: 81, notes: 'Drone survey done, report pending.'            },
    { name: 'Ngaio Harper',          email: 'ngaio@outlook.co.nz',     phone: '+64 4 555 012',  type: 'residential', system_type: 'hybrid',   location: 'Wellington',   monthly_bill: 380,   stage: 'won',           source: 'website',  assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 24500,  lifecycle: 'customer',    lead_score: 94, notes: '90-day check-in scheduled.'                    },
    { name: 'Tama Ropata',           email: 'tama@xtra.co.nz',         phone: '+64 21 555 013', type: 'residential', system_type: 'on-grid',  location: 'Rotorua',      monthly_bill: 310,   stage: 'new',           source: 'ad',       assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 15800,  lifecycle: 'subscriber',  lead_score: 18, notes: null },
    { name: 'Eden Park Sports Club', email: 'admin@edenpark.co.nz',    phone: '+64 9 555 014',  type: 'commercial',  system_type: 'on-grid',  location: 'Auckland',     monthly_bill: 9400,  stage: 'qualified',     source: 'referral', assigned_to: u['liam@goldenray.co.nz'],   company_id: null,                                  estimated_value: 275000, lifecycle: 'mql',         lead_score: 60, notes: 'Large flat roof — ideal commercial install.'   },
    { name: 'Mere Taiapa',           email: 'mere.t@gmail.com',         phone: '+64 27 555 015', type: 'residential', system_type: 'hybrid',   location: 'Gisborne',     monthly_bill: 295,   stage: 'proposal_sent', source: 'website',  assigned_to: u['sophie@goldenray.co.nz'], company_id: null,                                  estimated_value: 19200,  lifecycle: 'opportunity', lead_score: 70, notes: 'Proposal emailed, awaiting decision.'          },
  ], 'Contacts');
  const c = Object.fromEntries(contacts.map(x => [x.email, x.id]));

  // ── Campaigns ──────────────────────────────────────────────────────────────
  await ins('campaigns', [
    { name: 'Summer Solar Blitz',        type: 'email',    status: 'active',    channel: 'email',      budget: 4500,  spent: 3820, emails_sent: 2400, emails_opened: 1080, emails_clicked: 312, emails_bounced: 48, unsubscribed: 12, leads_generated: 48, conversions: 6,  revenue_attributed: 156000 },
    { name: 'Google Ads — Residential',  type: 'paid',     status: 'active',    channel: 'google_ads', budget: 12000, spent: 4200, leads_generated: 34, conversions: 4, revenue_attributed: 72200  },
    { name: 'Facebook Solar Awareness',  type: 'paid',     status: 'active',    channel: 'facebook',   budget: 6000,  spent: 2800, leads_generated: 22, conversions: 2, revenue_attributed: 39500  },
    { name: 'Commercial Outreach Q1',    type: 'email',    status: 'completed', channel: 'email',      budget: 1200,  spent: 1200, emails_sent: 800, emails_opened: 384, emails_clicked: 96, emails_bounced: 16, unsubscribed: 4, leads_generated: 12, conversions: 3, revenue_attributed: 653000 },
    { name: 'Green Business Webinar',    type: 'event',    status: 'completed', channel: 'event',      budget: 2000,  spent: 1850, leads_generated: 28, conversions: 1, revenue_attributed: 210000 },
    { name: 'Referral Bonus Program',    type: 'referral', status: 'active',    channel: 'referral',   budget: 8000,  spent: 3200, leads_generated: 18, conversions: 5, revenue_attributed: 597300 },
    { name: 'LinkedIn B2B Targeting',    type: 'paid',     status: 'active',    channel: 'linkedin',   budget: 9000,  spent: 2100, leads_generated: 8,  conversions: 1, revenue_attributed: 198000 },
    { name: 'Autumn Newsletter Series',  type: 'email',    status: 'active',    channel: 'email',      budget: 800,   spent: 320,  emails_sent: 1800, emails_opened: 756, emails_clicked: 198, emails_bounced: 36, unsubscribed: 8, leads_generated: 6, conversions: 0, revenue_attributed: 0 },
  ], 'Campaigns');

  // ── System Config ──────────────────────────────────────────────────────────
  await ins('system_config', [
    { key: 'solar_pricing', value: { costPerKw: 1850, batteryCostPerKwh: 890, taxRate: 15, markup: 12, defaultElecRate: 0.32, laborPct: 18, panelWatts: 550, sunHours: 4.5, inverterPct: 14 }, updated_by: u['aroha@goldenray.co.nz'] },
    { key: 'company_info',  value: { name: 'GoldenRay Energy', email: 'hello@goldenrayenergy.co.nz', phone: '+64 21 839 356', address: 'Level 3, 45 Queen St, Auckland' }, updated_by: u['aroha@goldenray.co.nz'] },
  ], 'System Config');

  // ── Deals ──────────────────────────────────────────────────────────────────
  const deals = await ins('deals', [
    { name: 'Te Whiti Ngata — 8kW On-Grid Auckland',        contact_id: c['tewhiti@xtra.co.nz'],      company_id: null,                                  amount: 14200,  stage: 'proposal',     owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-04-30', priority: 'high',   probability: 65,  notes: 'Proposal sent. Customer reviewing pricing.'                },
    { name: 'Pacific Fresh Ltd — 95kW Hybrid System',        contact_id: c['ops@pacificfresh.co.nz'],  company_id: 'c0c0c0c0-0000-0000-0000-000000000001', amount: 185000, stage: 'negotiation',  owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-05-15', priority: 'high',   probability: 80,  notes: 'Board requesting 8% discount. Counter: 3% + free monitoring.' },
    { name: 'Hannah Brown — 12kW Off-Grid Cabin',            contact_id: c['hannah@gmail.com'],         company_id: null,                                  amount: 21000,  stage: 'qualified',    owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-05-20', priority: 'medium', probability: 40,  notes: 'Site survey booked. Queenstown cabin, summer use.'          },
    { name: 'James Wilson — 7kW On-Grid Wellington',         contact_id: c['wilson@outlook.co.nz'],    company_id: null,                                  amount: 16500,  stage: 'closed_won',   owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-03-15', priority: 'medium', probability: 100, notes: 'Installation complete. Customer very satisfied.'           },
    { name: 'Kiwi Dairy Co-op — 180kW On-Grid Hamilton',    contact_id: c['admin@kiwidairy.co.nz'],   company_id: 'c0c0c0c0-0000-0000-0000-000000000002', amount: 245000, stage: 'closed_won',   owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-02-28', priority: 'high',   probability: 100, notes: '218 panels commissioned. Grid export approved.'            },
    { name: 'Aroha Tuhoe — 9kW Hybrid Tauranga',            contact_id: c['aroha.tuhoe@gmail.com'],   company_id: null,                                  amount: 18500,  stage: 'appointment',  owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-05-30', priority: 'low',    probability: 20,  notes: 'Initial enquiry. Site visit to book.'                      },
    { name: 'Rawiri Hotels — 250kW Queenstown Resort',       contact_id: c['ops@rawirihotels.co.nz'],  company_id: 'c0c0c0c0-0000-0000-0000-000000000003', amount: 320000, stage: 'closed_won',   owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-01-20', priority: 'high',   probability: 100, notes: 'Main building + spa. Generating 15% above forecast.'       },
    { name: 'Linda Garcia — 14kW On-Grid Nelson',            contact_id: c['linda@proton.me'],          company_id: null,                                  amount: 26800,  stage: 'qualified',    owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-05-10', priority: 'medium', probability: 50,  notes: 'One competing quote. Following up this week.'              },
    { name: 'NZ Greens Produce — 110kW Hybrid Farm',         contact_id: c['farm@nzgreens.co.nz'],     company_id: 'c0c0c0c0-0000-0000-0000-000000000004', amount: 198000, stage: 'presentation', owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-05-25', priority: 'high',   probability: 60,  notes: 'Board presentation scheduled. ROI deck sent.'              },
    { name: 'Sam Chen — 6kW On-Grid Auckland',               contact_id: c['samchen@gmail.com'],        company_id: null,                                  amount: 15200,  stage: 'closed_lost',  owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-03-01', priority: 'low',    probability: 0,   notes: 'Lost on price.', lost_reason: 'Price — competitor $1,200 cheaper' },
    { name: 'Southern Cross Winery — 140kW Marlborough',     contact_id: c['ops@scwinery.co.nz'],      company_id: 'c0c0c0c0-0000-0000-0000-000000000005', amount: 210000, stage: 'appointment',  owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-06-01', priority: 'high',   probability: 35,  notes: 'Drone survey done. Awaiting shading report.'               },
    { name: 'Ngaio Harper — 11kW Hybrid Wellington',         contact_id: c['ngaio@outlook.co.nz'],     company_id: null,                                  amount: 24500,  stage: 'closed_won',   owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-02-10', priority: 'medium', probability: 100, notes: 'System commissioned. Battery performing above spec.'       },
    { name: 'Eden Park Sports Club — 200kW Auckland',        contact_id: c['admin@edenpark.co.nz'],    company_id: null,                                  amount: 275000, stage: 'qualified',    owner_id: u['liam@goldenray.co.nz'],   close_date: '2026-06-15', priority: 'high',   probability: 45,  notes: 'Large flat roof. Council consent in progress.'             },
    { name: 'Mere Taiapa — 9kW Hybrid Gisborne',            contact_id: c['mere.t@gmail.com'],         company_id: null,                                  amount: 19200,  stage: 'proposal',     owner_id: u['sophie@goldenray.co.nz'], close_date: '2026-05-05', priority: 'medium', probability: 55,  notes: 'Proposal emailed. Waiting on response.'                    },
  ], 'Deals');
  const d = Object.fromEntries(deals.map(x => [x.name, x.id]));
  const did = (p) => Object.entries(d).find(([k]) => k.startsWith(p))?.[1] ?? null;

  // ── Tasks ──────────────────────────────────────────────────────────────────
  await ins('tasks', [
    { title: 'Follow-up call — Te Whiti Ngata proposal',      description: 'Check if customer reviewed proposal. Answer any pricing questions.',             assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['tewhiti@xtra.co.nz'],      deal_id: did('Te Whiti'),        due_date: '2026-04-22', priority: 'high',   status: 'in_progress', task_type: 'call'     },
    { title: 'Negotiation meeting — Pacific Fresh Ltd',        description: 'Prepare revised pricing: 3% discount + free 5-yr monitoring counter-offer.',     assignee_id: u['liam@goldenray.co.nz'],   contact_id: c['ops@pacificfresh.co.nz'],  deal_id: did('Pacific Fresh'),   due_date: '2026-04-23', priority: 'high',   status: 'todo',        task_type: 'meeting'  },
    { title: 'Book rooftop survey — Hannah Brown',             description: 'Schedule rooftop assessment. Bring drone. Off-grid cabin check.',                 assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['hannah@gmail.com'],         deal_id: did('Hannah'),          due_date: '2026-04-24', priority: 'medium', status: 'todo',        task_type: 'survey'   },
    { title: 'Send maintenance guide — James Wilson',          description: 'Email annual maintenance schedule, warranty docs, and monitoring app link.',       assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['wilson@outlook.co.nz'],    deal_id: null,                   due_date: '2026-04-21', priority: 'low',    status: 'todo',        task_type: 'email'    },
    { title: 'Board presentation prep — NZ Greens Produce',   description: 'Finalise ROI analysis, CO2 impact, and govt incentive slides for Tuesday.',       assignee_id: u['liam@goldenray.co.nz'],   contact_id: c['farm@nzgreens.co.nz'],     deal_id: did('NZ Greens'),       due_date: '2026-04-25', priority: 'high',   status: 'in_progress', task_type: 'proposal' },
    { title: 'Competitive follow-up — Linda Garcia',           description: 'Customer has competitor quote. Emphasise 25-yr warranty and local support.',       assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['linda@proton.me'],          deal_id: did('Linda'),           due_date: '2026-04-22', priority: 'medium', status: 'todo',        task_type: 'call'     },
    { title: 'Compile survey report — Southern Cross Winery', description: 'Write up drone imagery and shading analysis. Send PDF to client.',                 assignee_id: u['liam@goldenray.co.nz'],   contact_id: c['ops@scwinery.co.nz'],      deal_id: did('Southern Cross'),  due_date: '2026-04-28', priority: 'high',   status: 'todo',        task_type: 'report'   },
    { title: 'Initial site visit — Aroha Tuhoe',               description: 'Introduce GoldenRay. Assess roof, understand energy needs, demo monitoring app.', assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['aroha.tuhoe@gmail.com'],   deal_id: did('Aroha'),           due_date: '2026-04-20', priority: 'medium', status: 'overdue',     task_type: 'meeting'  },
    { title: 'Generate hybrid proposal — Aroha Tuhoe',         description: 'Run calculator for 9kW hybrid. Include battery backup sizing options.',            assignee_id: u['jack@goldenray.co.nz'],   contact_id: c['aroha.tuhoe@gmail.com'],   deal_id: did('Aroha'),           due_date: '2026-04-29', priority: 'medium', status: 'todo',        task_type: 'proposal' },
    { title: 'Submit grid connection paperwork — Kiwi Dairy',  description: 'Lodge final MCS and grid export certification with local authority.',              assignee_id: u['liam@goldenray.co.nz'],   contact_id: c['admin@kiwidairy.co.nz'],   deal_id: null,                   due_date: '2026-04-15', priority: 'low',    status: 'completed',   task_type: 'admin'    },
    { title: 'Review commissioning photos — Rawiri Hotels',    description: 'Quality-check install photos before sending sign-off pack to client.',             assignee_id: u['jack@goldenray.co.nz'],   contact_id: c['ops@rawirihotels.co.nz'],  deal_id: null,                   due_date: '2026-03-01', priority: 'medium', status: 'completed',   task_type: 'review'   },
    { title: '90-day performance check-in — Ngaio Harper',    description: 'Schedule 90-day review. Share dashboard access and savings summary.',              assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['ngaio@outlook.co.nz'],     deal_id: null,                   due_date: '2026-05-10', priority: 'low',    status: 'todo',        task_type: 'call'     },
    { title: 'Council consent application — Eden Park',        description: 'Prepare and submit consent documents. Include structural loading report.',         assignee_id: u['liam@goldenray.co.nz'],   contact_id: c['admin@edenpark.co.nz'],    deal_id: did('Eden Park'),       due_date: '2026-05-01', priority: 'high',   status: 'todo',        task_type: 'admin'    },
    { title: 'Follow-up on proposal — Mere Taiapa',            description: 'No response in 5 days. Call to confirm proposal received and answer questions.',   assignee_id: u['sophie@goldenray.co.nz'], contact_id: c['mere.t@gmail.com'],         deal_id: did('Mere'),            due_date: '2026-04-26', priority: 'medium', status: 'todo',        task_type: 'call'     },
    { title: 'Import new leads — Summer Solar Blitz',          description: 'Pull form submissions from website, deduplicate, assign to Sophie.',               assignee_id: u['aroha@goldenray.co.nz'],  contact_id: null,                          deal_id: null,                   due_date: '2026-04-21', priority: 'medium', status: 'todo',        task_type: 'admin'    },
    { title: 'Quarterly revenue report — April 2026',          description: 'Compile closed deals, pipeline value, conversion rates for board meeting.',        assignee_id: u['aroha@goldenray.co.nz'],  contact_id: null,                          deal_id: null,                   due_date: '2026-04-30', priority: 'high',   status: 'todo',        task_type: 'report'   },
  ], 'Tasks');

  // ── Activities ─────────────────────────────────────────────────────────────
  await ins('activities', [
    { type: 'call',    description: 'Initial enquiry call. $280/month bill. Interested in 8kW on-grid. South-facing roof confirmed.',               contact_id: c['tewhiti@xtra.co.nz'],      deal_id: did('Te Whiti'),       user_id: u['sophie@goldenray.co.nz'], duration_minutes: 18,  outcome: 'interested',  created_at: ago(14)  },
    { type: 'meeting', description: 'Site visit complete. Minimal shading. Roof in great condition. 14-panel layout confirmed.',                   contact_id: c['tewhiti@xtra.co.nz'],      deal_id: did('Te Whiti'),       user_id: u['sophie@goldenray.co.nz'], duration_minutes: 90,  outcome: 'positive',    created_at: ago(7)   },
    { type: 'email',   description: 'Proposal sent — 8kW system, 14 panels, $14,200 incl. GST. PDF attached.',                                    contact_id: c['tewhiti@xtra.co.nz'],      deal_id: did('Te Whiti'),       user_id: u['jack@goldenray.co.nz'],   duration_minutes: 10,  outcome: 'sent',        created_at: ago(3)   },
    { type: 'call',    description: 'Commercial enquiry. Factory runs 24/7 — huge savings potential identified.',                                   contact_id: c['ops@pacificfresh.co.nz'],  deal_id: did('Pacific Fresh'),  user_id: u['liam@goldenray.co.nz'],   duration_minutes: 25,  outcome: 'interested',  created_at: ago(30)  },
    { type: 'meeting', description: 'Board presentation — 95kW hybrid. $185k total, 4.0yr payback, $46k/yr savings.',                             contact_id: c['ops@pacificfresh.co.nz'],  deal_id: did('Pacific Fresh'),  user_id: u['liam@goldenray.co.nz'],   duration_minutes: 120, outcome: 'positive',    created_at: ago(10)  },
    { type: 'call',    description: 'Negotiation call — board wants 8% discount. Countered with 3% + free 5-yr monitoring subscription.',         contact_id: c['ops@pacificfresh.co.nz'],  deal_id: did('Pacific Fresh'),  user_id: u['liam@goldenray.co.nz'],   duration_minutes: 35,  outcome: 'negotiating', created_at: ago(2)   },
    { type: 'call',    description: 'Wants fully off-grid system for Queenstown cabin. 3 bed, summer use only.',                                    contact_id: c['hannah@gmail.com'],         deal_id: did('Hannah'),         user_id: u['sophie@goldenray.co.nz'], duration_minutes: 22,  outcome: 'interested',  created_at: ago(18)  },
    { type: 'call',    description: 'Standard residential enquiry via website. Wellington suburb, 7kW on-grid suits usage well.',                  contact_id: c['wilson@outlook.co.nz'],    deal_id: did('James Wilson'),   user_id: u['sophie@goldenray.co.nz'], duration_minutes: 20,  outcome: 'interested',  created_at: ago(60)  },
    { type: 'meeting', description: 'Site visit — 7kW layout confirmed. Wellington wind assessed — standard fittings sufficient.',                contact_id: c['wilson@outlook.co.nz'],    deal_id: did('James Wilson'),   user_id: u['sophie@goldenray.co.nz'], duration_minutes: 75,  outcome: 'positive',    created_at: ago(50)  },
    { type: 'note',    description: 'Contract signed. 50% deposit received. Installation scheduled 10 March.',                                    contact_id: c['wilson@outlook.co.nz'],    deal_id: did('James Wilson'),   user_id: u['liam@goldenray.co.nz'],   duration_minutes: 0,   outcome: null,          created_at: ago(45)  },
    { type: 'meeting', description: 'Technical scoping with engineering team — 180kW on-grid design finalised. Single-axis roof mounting.',       contact_id: c['admin@kiwidairy.co.nz'],   deal_id: did('Kiwi Dairy'),     user_id: u['liam@goldenray.co.nz'],   duration_minutes: 180, outcome: 'positive',    created_at: ago(90)  },
    { type: 'note',    description: 'Full installation complete — 218 panels. Grid export approved. First bill shows 78% reduction.',             contact_id: c['admin@kiwidairy.co.nz'],   deal_id: null,                  user_id: u['liam@goldenray.co.nz'],   duration_minutes: 0,   outcome: null,          created_at: ago(50)  },
    { type: 'call',    description: 'Referral from James Wilson. Large Nelson property. Interested in 14kW with battery option.',                  contact_id: c['linda@proton.me'],          deal_id: did('Linda'),          user_id: u['sophie@goldenray.co.nz'], duration_minutes: 30,  outcome: 'interested',  created_at: ago(12)  },
    { type: 'email',   description: 'Detailed proposal sent with 25-yr savings projection, CO2 impact, and financing options.',                   contact_id: c['linda@proton.me'],          deal_id: did('Linda'),          user_id: u['jack@goldenray.co.nz'],   duration_minutes: 15,  outcome: 'sent',        created_at: ago(5)   },
    { type: 'meeting', description: 'Preliminary scoping — 110kW hybrid. Large barn roof ideal. Battery sized for overnight irrigation.',         contact_id: c['farm@nzgreens.co.nz'],     deal_id: did('NZ Greens'),      user_id: u['liam@goldenray.co.nz'],   duration_minutes: 90,  outcome: 'positive',    created_at: ago(20)  },
    { type: 'email',   description: 'Board-ready deck sent — ROI model, govt rebates, flexible finance options, CO2 impact chart.',               contact_id: c['farm@nzgreens.co.nz'],     deal_id: did('NZ Greens'),      user_id: u['jack@goldenray.co.nz'],   duration_minutes: 20,  outcome: 'sent',        created_at: ago(3)   },
    { type: 'call',    description: 'Customer rang to say they chose competitor — price $1,200 cheaper. Feedback logged for pricing review.',     contact_id: c['samchen@gmail.com'],        deal_id: did('Sam Chen'),       user_id: u['sophie@goldenray.co.nz'], duration_minutes: 10,  outcome: 'lost',        created_at: ago(35)  },
    { type: 'meeting', description: 'Kick-off — 250kW across main building and spa block. Contract signed for $320k.',                            contact_id: c['ops@rawirihotels.co.nz'],  deal_id: did('Rawiri'),         user_id: u['liam@goldenray.co.nz'],   duration_minutes: 150, outcome: 'positive',    created_at: ago(120) },
    { type: 'note',    description: 'Commissioning complete. Generating 15% above forecast. Client posted 5-star Google review.',                 contact_id: c['ops@rawirihotels.co.nz'],  deal_id: null,                  user_id: u['liam@goldenray.co.nz'],   duration_minutes: 0,   outcome: null,          created_at: ago(60)  },
    { type: 'call',    description: 'Inbound referral from Kiwi Dairy. Winery needs large commercial system for off-peak energy storage.',        contact_id: c['ops@scwinery.co.nz'],      deal_id: did('Southern Cross'), user_id: u['liam@goldenray.co.nz'],   duration_minutes: 28,  outcome: 'interested',  created_at: ago(15)  },
    { type: 'call',    description: 'Hybrid system enquiry. Wants battery backup for Wellington winter outages.',                                   contact_id: c['ngaio@outlook.co.nz'],     deal_id: did('Ngaio'),          user_id: u['sophie@goldenray.co.nz'], duration_minutes: 20,  outcome: 'interested',  created_at: ago(80)  },
    { type: 'note',    description: 'Installation and commissioning complete. Battery providing full overnight cover. Customer thrilled.',         contact_id: c['ngaio@outlook.co.nz'],     deal_id: null,                  user_id: u['sophie@goldenray.co.nz'], duration_minutes: 0,   outcome: null,          created_at: ago(55)  },
    { type: 'call',    description: 'Initial enquiry — 200kW commercial for sports stadium. Large flat roof, ideal install conditions.',           contact_id: c['admin@edenpark.co.nz'],    deal_id: did('Eden Park'),      user_id: u['liam@goldenray.co.nz'],   duration_minutes: 40,  outcome: 'interested',  created_at: ago(8)   },
    { type: 'email',   description: 'Sent proposal with full technical spec, ROI model, and council consent checklist.',                          contact_id: c['mere.t@gmail.com'],         deal_id: did('Mere'),           user_id: u['jack@goldenray.co.nz'],   duration_minutes: 12,  outcome: 'sent',        created_at: ago(5)   },
  ], 'Activities');

  // ── Proposals ──────────────────────────────────────────────────────────────
  await ins('proposals', [
    { contact_id: c['tewhiti@xtra.co.nz'],     deal_id: did('Te Whiti'),    system_size_kw: 8.0,   panel_count: 14,  battery_kwh: 0,  total_cost: 14200,  monthly_savings: 217,  annual_savings: 2604,   payback_years: 5.5, roi_percent: 280, co2_tons_year: 2.1,  status: 'sent',     sent_at: ago(3)   },
    { contact_id: c['ops@pacificfresh.co.nz'], deal_id: did('Pacific Fresh'),system_size_kw: 95.0,  panel_count: 172, battery_kwh: 30, total_cost: 185000, monthly_savings: 3840, annual_savings: 46080,  payback_years: 4.0, roi_percent: 355, co2_tons_year: 24.8, status: 'viewed',   sent_at: ago(8)   },
    { contact_id: c['wilson@outlook.co.nz'],   deal_id: did('James Wilson'), system_size_kw: 7.0,   panel_count: 13,  battery_kwh: 0,  total_cost: 16500,  monthly_savings: 251,  annual_savings: 3012,   payback_years: 5.5, roi_percent: 270, co2_tons_year: 1.8,  status: 'accepted', sent_at: ago(48)  },
    { contact_id: c['admin@kiwidairy.co.nz'],  deal_id: did('Kiwi Dairy'),   system_size_kw: 180.0, panel_count: 327, battery_kwh: 0,  total_cost: 245000, monthly_savings: 6560, annual_savings: 78720,  payback_years: 3.1, roi_percent: 420, co2_tons_year: 47.0, status: 'accepted', sent_at: ago(88)  },
    { contact_id: c['ops@rawirihotels.co.nz'], deal_id: did('Rawiri'),       system_size_kw: 250.0, panel_count: 454, battery_kwh: 0,  total_cost: 320000, monthly_savings: 9600, annual_savings: 115200, payback_years: 2.8, roi_percent: 460, co2_tons_year: 65.2, status: 'accepted', sent_at: ago(118) },
    { contact_id: c['ngaio@outlook.co.nz'],    deal_id: did('Ngaio'),        system_size_kw: 11.0,  panel_count: 20,  battery_kwh: 10, total_cost: 24500,  monthly_savings: 370,  annual_savings: 4440,   payback_years: 5.5, roi_percent: 265, co2_tons_year: 2.9,  status: 'accepted', sent_at: ago(78)  },
    { contact_id: c['linda@proton.me'],         deal_id: did('Linda'),        system_size_kw: 14.0,  panel_count: 25,  battery_kwh: 0,  total_cost: 26800,  monthly_savings: 431,  annual_savings: 5172,   payback_years: 5.2, roi_percent: 285, co2_tons_year: 3.7,  status: 'sent',     sent_at: ago(5)   },
    { contact_id: c['farm@nzgreens.co.nz'],    deal_id: did('NZ Greens'),    system_size_kw: 110.0, panel_count: 200, battery_kwh: 20, total_cost: 198000, monthly_savings: 5200, annual_savings: 62400,  payback_years: 3.2, roi_percent: 395, co2_tons_year: 28.8, status: 'draft',    sent_at: null     },
    { contact_id: c['mere.t@gmail.com'],        deal_id: did('Mere'),         system_size_kw: 9.0,   panel_count: 16,  battery_kwh: 10, total_cost: 19200,  monthly_savings: 291,  annual_savings: 3492,   payback_years: 5.5, roi_percent: 270, co2_tons_year: 2.4,  status: 'sent',     sent_at: ago(5)   },
  ], 'Proposals');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✨ Seed complete — Employee Portal Login Credentials');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Admin:    aroha@goldenray.co.nz   / admin123');
  console.log('  Manager:  liam@goldenray.co.nz    / manager123');
  console.log('  Sales:    sophie@goldenray.co.nz  / sales123');
  console.log('  Proposal: jack@goldenray.co.nz    / proposal123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

seed().catch(err => { console.error('\n❌ Seed failed:', err.message); process.exit(1); });
