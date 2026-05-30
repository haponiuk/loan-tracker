import {createClient} from '@supabase/supabase-js';

const defaultSupabaseUrl = 'https://zmusanlelrmmrurixgxf.supabase.co';
const defaultSupabasePublishableKey = 'sb_publishable_VpBSWNhe2hHpyDsbM_-yPA_--TxBM0x';

const supabaseUrl =
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_URL ||
    defaultSupabaseUrl;
const supabaseKey =
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    defaultSupabasePublishableKey;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = hasSupabaseConfig
    ? createClient(supabaseUrl, supabaseKey, {
          auth: {
              persistSession: false,
              autoRefreshToken: false,
          },
      })
    : null;
