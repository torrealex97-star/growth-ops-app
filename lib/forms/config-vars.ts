// Lectura de un ajuste por subcuenta (Configuración › Integraciones) para inyectarlo como variable
// en un formulario público, p. ej. el enlace de reseñas de Trustpilot. Solo servidor.

import { getTenantConfigWithFallback } from '@/lib/config'

export async function getConfigValue(tenantId: string, key: string): Promise<string | undefined> {
  try {
    const cfg = await getTenantConfigWithFallback(tenantId)
    const v = cfg[key]?.trim()
    return v || undefined
  } catch {
    return undefined
  }
}
