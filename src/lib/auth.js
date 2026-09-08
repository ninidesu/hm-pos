import { Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export const roleRoutes = {
  admin: '/admin',
  manager: '/admin',
  cashier: '/cashier',
}

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  return value
}

export function isCustomerRole(role) {
  return normalizeRole(role) === 'customer'
}

const portalProfileSelect = 'id, role, full_name, username, email, is_active, removed_at'

export async function getCurrentPortalSession() {
  if (!isSupabaseConfigured) return { session: null, profile: null, error: new Error('Supabase is not configured.') }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) return { session: null, profile: null, error: sessionError || null }

  const userId = sessionData.session.user.id
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(portalProfileSelect)
    .eq('id', userId)
    .maybeSingle()
  const activeProfile = profile && profile.is_active !== false && !profile.removed_at ? profile : null
  return { session: sessionData.session, profile: activeProfile, error: profileError || null }
}

export async function signInPortal({ identifier, email, password, role }) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured yet.')
  const requestedRole = normalizeRole(role)
  const loginIdentifier = String(identifier || email || '').trim()
  let loginEmail = loginIdentifier
  if (!loginIdentifier.includes('@')) {
    const { data: resolvedEmail, error: resolveError } = await supabase.rpc('resolve_portal_login_email', { p_username: loginIdentifier })
    const resolveErrorMessage = `${resolveError?.message || ''} ${resolveError?.details || ''}`.toLowerCase()
    if (resolveError && (resolveError.code === 'PGRST202' || resolveErrorMessage.includes('resolve_portal_login_email'))) {
      throw new Error('Username login setup is incomplete. Apply the latest HM POS Supabase migration.')
    }
    if (resolveError || !resolvedEmail) throw new Error('Invalid email, username, or password.')
    loginEmail = resolvedEmail
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
  if (error) throw error

  return verifyPortalRole(data, role)
}

async function verifyPortalRole(data, role) {
  const requestedRole = normalizeRole(role)
  const userId = data.user?.id
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(portalProfileSelect)
    .eq('id', userId)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile || profile.is_active === false || profile.removed_at) {
    await supabase.auth.signOut()
    throw new Error('This account no longer has portal access.')
  }
  const actualRole = normalizeRole(profile.role)
  const roleMatches = requestedRole === actualRole
    || (requestedRole === 'admin' && actualRole === 'manager')
  if (!roleMatches) {
    await supabase.auth.signOut()
    throw new Error(`This account is registered as ${profile.role || 'another role'}, not ${role}.`)
  }

  await supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', userId)
  return { session: data.session, profile }
}

export async function signOutPortal() {
  if (isSupabaseConfigured) await supabase.auth.signOut()
}
