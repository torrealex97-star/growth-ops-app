import crypto from 'crypto'
import type { VeredictoFirma } from './verifySecret'

// FIRMA DEL WEBHOOK DE TYPEFORM.
//
// Typeform firma el cuerpo CRUDO con HMAC-SHA256 y el secreto que se escribe al crear el webhook, y lo
// manda en `Typeform-Signature: sha256=<base64>`. Se calcula sobre los bytes exactos recibidos:
// parsear y volver a serializar cambia el orden de claves y los espacios, y la firma dejaría de cuadrar.
// Mismo criterio que los demás: fail-closed sin secreto, comparación en tiempo constante, y el motivo
// del rechazo es para el LOG, nunca para la respuesta.
export function verificarFirmaTypeform(raw: string, cabeceras: Headers, secreto: string | undefined): VeredictoFirma {
  if (!secreto) {
    return {
      valida: false,
      motivo: 'no hay TYPEFORM_WEBHOOK_SECRET guardado para esta subcuenta (Configuración → Integraciones → Typeform)',
    }
  }
  const recibida = cabeceras.get('typeform-signature')
  if (!recibida) return { valida: false, motivo: 'falta la cabecera Typeform-Signature' }
  if (!recibida.startsWith('sha256=')) return { valida: false, motivo: 'Typeform-Signature con formato inesperado' }
  const esperada = `sha256=${crypto.createHmac('sha256', secreto).update(raw).digest('base64')}`
  const a = Buffer.from(recibida)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valida: false, motivo: 'la firma no coincide con el secreto guardado' }
  }
  return { valida: true, motivo: null }
}
