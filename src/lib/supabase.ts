import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// If the environment variables are not set, we might be using the previous window client for now
// but for a fresh Vite project, we should recommend setting them up.
export const supabase = (window as any).kbSupabaseClient || createClient(supabaseUrl, supabaseAnonKey);
