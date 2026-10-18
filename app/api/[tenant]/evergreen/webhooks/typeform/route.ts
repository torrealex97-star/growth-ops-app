import { NextRequest } from 'next/server'
import { procesarEntradaTypeform } from '@/lib/typeform/entrada'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK ENTRANTE DE TYPEFORM — respuestas de formularios en el momento.
//
// Sirve a dos usos: cualificación de leads (el formulario previo a agendar) y feedback de alumnos.
// Todo el esqueleto vive en lib/typeform/entrada.ts. El secreto se escribe al crear el webhook en
// Typeform (Connect → Webhooks → Secret) y se guarda en Integraciones → Typeform.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  return procesarEntradaTypeform({ req, params })
}
