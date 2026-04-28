import { supabaseAdmin } from '../config/supabase.js';

const Task = {
  async findAll(filters = {}) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    let q = supabaseAdmin
      .from('tasks')
      .select(`
        *,
        assignee:users!assignee_id ( name ),
        contact:contacts!contact_id ( name )
      `)
      .order('due_date', { ascending: true });

    if (filters.assignee_id) q = q.eq('assignee_id', filters.assignee_id);
    if (filters.status) q = q.eq('status', filters.status);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(t => ({
      ...t,
      assignee_name: t.assignee?.name || null,
      contact_name: t.contact?.name || null,
    }));
  },

  async create(taskData) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert(taskData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    if (updates.status === 'completed') updates.completed_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id);
    if (error) throw error;
  },
};
export default Task;
