// Lo que el navegador público puede ver de una versión publicada: la config SIN los pesos de scoring
// ni los umbrales. Las condiciones de final sobre `$score`/`$temperature` se conservan (el cliente no
// puede evaluarlas y las ignora; la decisión autoritativa la devuelve el servidor al enviar).

import type { FormConfig } from './types'

export function stripForPublic(config: FormConfig): FormConfig {
  const { scoring: _scoring, ...rest } = config
  return { ...rest, scoring: undefined }
}
