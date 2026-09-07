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

const portalProfileSelect = 'id, role, full_name, username, email'

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
  return { session: sessionData.session, profile, error: profileError || null }
}

export async function signInPortal({ identifier, email, password, role }) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured yet.')
  const requestedRole = normalizeRole(role)
  const loginIdentifier = String(identifier || email || '').trim()
  let loginEmail = loginIdentifier
  if (!loginIdentifier.includes('@')) {
    const { data: resolvedEmail, error: resolveError } = await supabase.rpc('resolve_portal_login_email', { p_username: loginIdentifier })
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
  if (!profile) throw new Error('Login succeeded, but no portal profile was found for this account.')
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
