import { supabaseAdmin } from '../config/supabase.js';

const Contact = {
  async findAll({ stage, type, source, assigned_to, search, limit = 100, offset = 0 } = {}) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    let q = supabaseAdmin
      .from('contacts')
      .select(`
        *,
        owner:users!assigned_to ( name ),
        company:companies!company_id ( name )
      `)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (stage) q = q.eq('stage', stage);
    if (type) q = q.eq('type', type);
    if (source) q = q.eq('source', source);
    if (assigned_to) q = q.eq('assigned_to', assigned_to);
    if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) throw error;
    // Flatten joined names
    return (data || []).map(c => ({
      ...c,
      owner_name: c.owner?.name || null,
      company_name: c.company?.name || null,
    }));
  },

  async findById(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select(`*, owner:users!assigned_to ( name ), company:companies!company_id ( name )`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data ? { ...data, owner_name: data.owner?.name, company_name: data.company?.name } : null;
  },

  async create(contactData) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert(contactData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id);
    if (error) throw error;
  },

  async getStats() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin.rpc('get_contact_stats');
    if (!error && data) return data;
    // Fallback: fetch all and aggregate in JS
    const { data: all } = await supabaseAdmin.from('contacts').select('stage, estimated_value');
    const stages = {};
    (all || []).forEach(c => {
      if (!stages[c.stage]) stages[c.stage] = { stage: c.stage, count: 0, total_value: 0 };
      stages[c.stage].count++;
      stages[c.stage].total_value += Number(c.estimated_value || 0);
    });
    return Object.values(stages);
  },

  async getBySource() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data: all } = await supabaseAdmin.from('contacts').select('source');
    const sources = {};
    (all || []).forEach(c => { const s = c.source || 'other'; sources[s] = (sources[s] || 0) + 1; });
    return Object.entries(sources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  },

  async getByRegion() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data: all } = await supabaseAdmin.from('contacts').select('location');
    const regions = {};
    (all || []).forEach(c => { if (c.location) regions[c.location] = (regions[c.location] || 0) + 1; });
    return Object.entries(regions).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
  }
};
export default Contact;
