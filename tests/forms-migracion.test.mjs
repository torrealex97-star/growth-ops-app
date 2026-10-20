import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(join(raiz, 'supabase/migrations/20261020100000_forms_module.sql'), 'utf8')
const TABLAS = ['forms', 'form_versions', 'form_responses', 'form_sessions', 'form_webhooks', 'form_webhook_deliveries']

test('toda tabla del módulo tiene tenant_id NOT NULL, RLS y policy restrictiva de aislamiento', () => {
  for (const t of TABLAS) {
    const bloque = sql.slice(
      sql.indexOf(`create table public.${t} (`),
      sql.indexOf(');', sql.indexOf(`create table public.${t} (`))
    )
    assert.match(bloque, /tenant_id uuid not null references public\.tenants\(id\)/, `${t}: tenant_id`)
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t}: RLS`)
    assert.match(
      sql,
      new RegExp(`create policy "${t}_tenant_isolation" on public\\.${t} as restrictive for all`),
      `${t}: aislamiento`
    )
  }
})

test('anon no tiene ningún permiso: los envíos públicos entran solo por el servidor', () => {
  assert.match(sql, /revoke all on public\.forms,[\s\S]*from public, anon/)
  assert.doesNotMatch(sql, /to anon/)
  assert.doesNotMatch(sql, /for insert to authenticated[^;]*form_responses/)
})

test('las versiones publicadas son inmutables (sin update/delete por RLS)', () => {
  assert.doesNotMatch(sql, /create policy "form_versions_(update|delete)/)
  assert.doesNotMatch(sql, /on public\.form_versions for (update|delete|all)/)
})

test('el secreto del webhook está cifrado y el navegador no puede leerlo', () => {
  assert.match(sql, /secret_enc text not null/)
  assert.match(sql, /grant select \(id, tenant_id, form_id, url, active, created_at\) on public\.form_webhooks/)
  assert.doesNotMatch(sql, /grant select[^;(]*public\.form_webhooks[^;]*to authenticated/)
})

test('los helpers de auth van en InitPlan: (select public.…) y nunca llamadas desnudas', () => {
  const policies = sql.split('create policy').slice(1)
  for (const p of policies) {
    assert.doesNotMatch(
      p.replace(/\(select public\.[a-z_]+\(\)\)/g, ''),
      /public\.(get_my_role|is_super_admin|is_admin_or_director)\(\)/
    )
    assert.doesNotMatch(p.replace(/\(select public\.auth_tenant_ids\(\)\)/g, ''), /public\.auth_tenant_ids\(\)/)
  }
})

test('las respuestas (PII y candidaturas) se leen solo por roles concretos, no por ser miembro', () => {
  assert.match(
    sql,
    /"form_responses_select_roles"[\s\S]*get_my_role\(\)\) in \('admin', 'director', 'manager', 'marketing', 'csm'\)/
  )
  assert.doesNotMatch(sql, /form_responses[^;]*for select[^;]*using \(true\)/)
})

test('idempotencia y FKs: submission_id único por tenant y FKs compuestas con tenant', () => {
  assert.match(sql, /unique \(tenant_id, submission_id\)/)
  assert.match(sql, /foreign key \(tenant_id, form_id\) references public\.forms \(tenant_id, id\)/)
  assert.match(
    sql,
    /foreign key \(tenant_id, version_id\) references public\.form_versions \(tenant_id, id\) on delete restrict/
  )
})

test('endurecimiento: borrar formularios solo admin/director y las respuestas no se reescriben por PostgREST', () => {
  const h = readFileSync(join(raiz, 'supabase/migrations/20261020130000_forms_hardening.sql'), 'utf8')
  assert.match(h, /"forms_delete_roles" on public\.forms for delete[\s\S]*in \('admin', 'director'\)/)
  assert.doesNotMatch(h, /forms_[a-z]+_roles" on public\.forms for all/)
  assert.match(h, /grant update \(review_status, review_notes\) on public\.form_responses/)
  for (const p of h.split('create policy').slice(1)) {
    assert.doesNotMatch(p.replace(/\(select public\.get_my_role\(\)\)/g, ''), /public\.get_my_role\(\)/)
  }
})
