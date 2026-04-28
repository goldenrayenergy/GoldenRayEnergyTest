import { supabaseAdmin } from '../config/supabase.js';
import bcrypt from 'bcryptjs';

const User = {
  async findByEmail(email) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findById(id) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, avatar, created_at')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async findAll() {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, avatar, is_active, created_at')
      .order('name');
    if (error) throw error;
    return data;
  },

  async create({ name, email, password, role, avatar }) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({ name, email, password_hash, role, avatar })
      .select('id, name, email, role, avatar')
      .single();
    if (error) throw error;
    return data;
  },

  async verifyPassword(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
  },

  async update(id, fields) {
    if (!supabaseAdmin) throw new Error('Supabase not configured — Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};
export default User;
