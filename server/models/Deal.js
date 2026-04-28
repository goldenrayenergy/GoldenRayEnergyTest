import { supabaseAdmin } from '../config/supabase.js';

const PROB_MAP = { appointment: 10, qualified: 25, presentation: 40, proposal: 60, negotiation: 80, closed_won: 100, closed_lost: 0 };

const Deal = {
  async findAll(filters = {}) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    let q = supabaseAdmin
      .from('deals')
      .select(`
        *,
        owner:users!owner_id ( name ),
        contact:contacts!contact_id ( name ),
        company_rel:companies!company_id ( name )
      `)
      .order('updated_at', { ascending: false });

    if (filters.stage) q = q.eq('stage', filters.stage);
    if (filters.owner_id) q = q.eq('owner_id', filters.owner_id);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(d => ({
      ...d,
      owner_name: d.owner?.name || null,
      contact_name: d.contact?.name || null,
      company_name: d.company_rel?.name || null,
    }));
  },

  async findById(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('deals')
      .select(`*, owner:users!owner_id ( name ), contact:contacts!contact_id ( name )`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data ? { ...data, owner_name: data.owner?.name, contact_name: data.contact?.name } : null;
  },

  async create(dealData) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    dealData.probability = PROB_MAP[dealData.stage] ?? 10;
    const { data, error } = await supabaseAdmin
      .from('deals')
      .insert(dealData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    if (updates.stage) updates.probability = PROB_MAP[updates.stage] ?? updates.probability;
    const { data, error } = await supabaseAdmin
      .from('deals')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { error } = await supabaseAdmin.from('deals').delete().eq('id', id);
    if (error) throw error;
  },

  async getPipelineStats() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data: all } = await supabaseAdmin.from('deals').select('stage, amount, probability');
    const stages = {};
    (all || []).forEach(d => {
      if (!stages[d.stage]) stages[d.stage] = { stage: d.stage, count: 0, total: 0, weighted: 0 };
      stages[d.stage].count++;
      stages[d.stage].total += Number(d.amount || 0);
      stages[d.stage].weighted += Number(d.amount || 0) * (d.probability || 0) / 100;
    });
    return Object.values(stages);
  },

  async getForecast() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data: all } = await supabaseAdmin
      .from('deals')
      .select('stage, amount, probability, close_date')
      .gte('close_date', new Date(new Date().getFullYear(), 0, 1).toISOString());
    const months = {};
    (all || []).forEach(d => {
      const m = new Date(d.close_date).getMonth();
      const key = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m];
      if (!months[key]) months[key] = { month: key, month_num: m, closed: 0, forecast: 0 };
      if (d.stage === 'closed_won') months[key].closed += Number(d.amount || 0);
      else if (d.stage !== 'closed_lost') months[key].forecast += Number(d.amount || 0) * (d.probability || 0) / 100;
    });
    return Object.values(months).sort((a, b) => a.month_num - b.month_num);
  }
};
export default Deal;
