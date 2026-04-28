import { supabaseAdmin } from '../config/supabase.js';

const Campaign = {
  async findAll() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async findById(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(campaignData) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .insert(campaignData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { error } = await supabaseAdmin.from('campaigns').delete().eq('id', id);
    if (error) throw error;
  },

  async getStats() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data: all } = await supabaseAdmin.from('campaigns').select('channel, leads_generated, spent, revenue_attributed');
    const channels = {};
    (all || []).forEach(c => {
      const ch = c.channel || 'other';
      if (!channels[ch]) channels[ch] = { channel: ch, campaigns: 0, leads: 0, spent: 0, revenue: 0 };
      channels[ch].campaigns++;
      channels[ch].leads += Number(c.leads_generated || 0);
      channels[ch].spent += Number(c.spent || 0);
      channels[ch].revenue += Number(c.revenue_attributed || 0);
    });
    return Object.values(channels).sort((a, b) => b.revenue - a.revenue);
  }
};
export default Campaign;
