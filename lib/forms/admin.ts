// Autorización y utilidades de las rutas de ADMINISTRACIÓN de formularios (requieren sesión).
// Las escrituras usan service role, así que el control de rol vive aquí y no en RLS.

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { serviceClient } from './server'

const READ_ROLES = ['admin', 'director', 'manager', 'marketing', 'csm']
const WRITE_ROLES = ['admin', 'director', 'marketing']

export async function authorizeForms(tenant: string, write: boolean) {
  const auth = await requireTenant(tenant)
  if ('error' in auth) return { error: auth.error }
  const allowed = write ? WRITE_ROLES : READ_ROLES
  if (!auth.role || !allowed.includes(auth.role)) {
    return { error: NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 }) }
  }
  return { auth, sb: serviceClient() }
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s.length >= 3 ? s : `formulario-${s || 'nuevo'}`.slice(0, 60)
}
