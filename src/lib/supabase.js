import { createClient } from '@supabase/supabase-js'

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const supabase = url && anonKey ? createClient(url, anonKey) : null
export const isSupabaseConfigured = Boolean(supabase)
