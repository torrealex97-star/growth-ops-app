import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Revisión 27-oct (performance-observability): errores capturados que no dejaban rastro y llamadas sin tope de espera.
const leer = (p) => readFileSync(`app/api/[tenant]/evergreen/${p}`, 'utf8')

test('los webhooks registran el 500 que devuelven (Sentry solo ve los errores NO capturados)', () => {
  for (const w of ['fathom', 'calendly', 'contract', 'onboarding', 'ghl'])
    assert.match(leer(`webhooks/${w}/route.ts`), new RegExp(`console\\.error\\('\\[${w}\\] 500`), w)
})

test('las cancelaciones en Calendly tienen tope de espera de 10 s', () => {
  for (const f of ['appointments/cancel/route.ts', 'appointments/reschedule/route.ts', 'cron/reminders/route.ts'])
    assert.match(leer(f), /signal: AbortSignal\.timeout\(10_000\)/, f)
})

test('cancelar una cita no queda bloqueado si Calendly no responde: se captura el fallo y se sigue', () => {
  const c = leer('appointments/cancel/route.ts')
  assert.match(
    c,
    /try \{[\s\S]{0,400}AbortSignal\.timeout\(10_000\)[\s\S]{0,300}\} catch \(e\) \{[\s\S]{0,120}no respondió a tiempo/
  )
})
