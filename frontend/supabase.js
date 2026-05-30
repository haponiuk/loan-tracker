import {createClient} from '@supabase/supabase-js';

const supabaseUrl =
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey =
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    '';

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = hasSupabaseConfig
    ? createClient(supabaseUrl, supabaseKey, {
          auth: {
              persistSession: false,
              autoRefreshToken: false,
          },
      })
    : null;
