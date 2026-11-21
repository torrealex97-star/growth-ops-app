import { createClient } from '@supabase/supabase-js'

/** Cliente service-role de servidor para la formación. Siempre se usa con `tenant_id` explícito en cada consulta. */
export function servicioFormacion() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
