import { completeConversation } from '@/lib/ai/provider'
import { getTenantConfigWithFallback } from '@/lib/config'
import { cfgDesdeEnv, enviarMensajeGhl } from '@/lib/ghl/conversaciones'
import type { DepsOrquestador } from './orquestador'

/** Dependencias reales del orquestador: el motor de IA de la subcuenta y el envío por GHL. */
export async function depsReales(tenantId: string): Promise<DepsOrquestador> {
  const cfgTenant = await getTenantConfigWithFallback(tenantId, true)
  const ghl = cfgDesdeEnv(cfgTenant)
  return {
    ia: async (req) => {
      const r = await completeConversation({
        system: req.system,
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      })
      return { text: r.text, engine: r.engine, model: r.model }
    },
    enviar: async (p) => {
      if (!ghl) throw new Error('Faltan el token o el Location ID de GoHighLevel')
      return enviarMensajeGhl(ghl, {
        conversacionId: p.conversationExternalId,
        contactId: p.contactExternalId,
        canal: p.canal,
        texto: p.texto,
      })
    },
  }
}
