import { supabaseAdmin } from '../config/supabase.js';

const Activity = {
  async findAll({ contact_id, user_id, limit = 50 } = {}) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    let q = supabaseAdmin
      .from('activities')
      .select(`
        *,
        user:users!user_id ( name ),
        contact:contacts!contact_id ( name )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (contact_id) q = q.eq('contact_id', contact_id);
    if (user_id) q = q.eq('user_id', user_id);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(a => ({
      ...a,
      user_name: a.user?.name || null,
      contact_name: a.contact?.name || null,
    }));
  },

  async create(activityData) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('activities')
      .insert(activityData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
export default Activity;
