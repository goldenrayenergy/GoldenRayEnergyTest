import { supabaseAdmin } from '../config/supabase.js';

export const PROJECT_STAGES = ['new', 'design', 'selling', 'installation', 'maintenance', 'exit'];

// Required checklist-item IDs per stage — must match client/src/utils/stages.js
export const STAGE_REQUIRED_ITEMS = {
  new:          ['new.owner', 'new.call', 'new.qualify'],
  design:       ['design.photos', 'design.roof_data', 'design.system', 'design.simulation'],
  selling:      ['selling.proposal_pdf', 'selling.online_link', 'selling.send_email', 'selling.followup'],
  installation: ['install.deposit', 'install.schedule', 'install.crew', 'install.sld', 'install.commission', 'install.final_pay'],
  maintenance:  ['maint.6mo', 'maint.annual', 'maint.monitor'],
  exit:         ['exit.invoice', 'exit.nps'],
};

export function missingRequiredItems(stage, stageProgress = {}) {
  const required = STAGE_REQUIRED_ITEMS[stage] || [];
  return required.filter(id => stageProgress[id] !== true);
}

export async function generateProjectCode() {
  const year = new Date().getFullYear();
  const { count, error } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .like('code', `GR-${year}-%`);
  if (error) throw error;
  return `GR-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
}

// Round-robin auto-assignment: pick the active sales user (sales_exec or
// sales_mgr) with the fewest open New-stage projects. Falls back to null if
// no sales users exist. Ties broken by alphabetical name (deterministic).
async function pickRoundRobinOwner() {
  try {
    const { data: salesUsers } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .in('role', ['sales_exec', 'sales_mgr'])
      .eq('is_active', true)
      .order('name');
    if (!salesUsers || salesUsers.length === 0) return null;
    // Count open New-stage projects per user (only count the bucket of
    // currently-incoming leads, not historical workload).
    const counts = await Promise.all(salesUsers.map(async u => {
      const { count } = await supabaseAdmin
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', u.id)
        .eq('stage', 'new')
        .is('sub_status', null);
      return { id: u.id, name: u.name, count: count || 0 };
    }));
    counts.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
    return counts[0];
  } catch (e) {
    console.error('Round-robin owner pick failed (non-fatal):', e.message);
    return null;
  }
}

// Create a project for a new website enquiry. Called from /api/quote/submit.
export async function createProjectFromEnquiry({ form, calculation, contactId, systemType, enquiryId }) {
  const code  = await generateProjectCode();
  const owner = await pickRoundRobinOwner();

  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      code,
      customer_id:        contactId,
      website_enquiry_id: enquiryId || null,
      owner_id:           owner?.id || null,
      stage:              'new',
      address:            form.address || null,
      system_size_kw:     calculation?.systemSize  || null,
      panels:             calculation?.panels      || null,
      battery_kwh:        calculation?.batteryKwh  || null,
      system_type:        systemType               || null,
      estimated_value:    calculation?.totalCost   || null,
      notes:              form.installationType ? `Installation: ${form.installationType}${form.batteryOption ? ` · Battery: ${form.batteryOption}` : ''}` : null,
    })
    .select('id, code, owner_id')
    .single();
  if (error) throw error;

  // Activity entry so the team can see the auto-assignment
  if (owner?.id) {
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Auto-assigned to ${owner.name} (round-robin — fewest open New-stage projects)`,
      project_id:  data.id,
      contact_id:  contactId,
      metadata:    { trigger: 'round_robin_assign', owner_id: owner.id, owner_name: owner.name },
    });
  }

  return { ...data, owner_name: owner?.name || null };
}
