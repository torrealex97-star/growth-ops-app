# Módulo de Formularios

Formularios conversacionales (estilo Typeform/Formbricks) para captación y cualificación de clientes
y empleados y feedback de alumnos. Nació de un MVP externo (`maestro-forms`, Vite + localStorage) y
se reescribió sobre Supabase con multi-tenant real. Marketing › Formularios (administración),
`/<subcuenta>/f/<slug>` (público) y Alumnos › Feedback (lectura).

## Mapa

| Qué                                                                | Dónde                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Tipos, esquema zod con topes                                       | `lib/forms/types.ts`, `lib/forms/schema.ts`                        |
| Lógica pura (visibilidad, saltos, finales, piping)                 | `lib/forms/logic.ts`                                               |
| Validación (cliente y servidor) y publicabilidad                   | `lib/forms/validation.ts`                                          |
| Scoring (solo servidor), roles semánticos                          | `lib/forms/scoring.ts`, `lib/forms/semantic.ts`                    |
| Evaluación de un envío (final y redirección decididos en servidor) | `lib/forms/submission.ts`                                          |
| Analítica / feedback de alumnos (puras)                            | `lib/forms/analytics.ts`, `lib/forms/feedback.ts`                  |
| Webhooks salientes                                                 | `lib/forms/webhooks.ts`                                            |
| Plantillas (7)                                                     | `lib/forms/templates/index.ts`                                     |
| Motor público                                                      | `components/forms/engine/*`, `app/[tenant]/f/[slug]/page.tsx`      |
| Constructor                                                        | `components/forms/builder/*`                                       |
| API pública (sin sesión)                                           | `app/api/[tenant]/evergreen/forms/public/[slug]/{,session,submit}` |
| API de administración (sesión + rol)                               | `app/api/[tenant]/evergreen/forms/**`                              |
| Tablas                                                             | `supabase/migrations/20261020100000_forms_module.sql`              |

## Modelo de datos

`forms` (borrador editable) → `form_versions` (foto **inmutable** al publicar) → `form_responses`
(cada respuesta apunta a su versión). `form_sessions` guarda **una fila por sesión** (no por evento)
para no inflar la BD (Supabase Free). `form_webhooks` + `form_webhook_deliveries` para salientes.
Todas llevan `tenant_id`, FKs compuestas y una policy `RESTRICTIVE` de aislamiento; `anon` no tiene
ningún permiso. Los envíos públicos los escribe **solo el servidor** (service role) tras resolver el
tenant por slug.

## Reglas que no se deben romper

1. **Solo el camino real.** Se valida, puntúa, guarda y envía únicamente lo respondido en las
   preguntas por las que de verdad pasó la persona (`getPathAnswers`). Lo contestado en una rama que
   luego se abandonó (volver atrás, cambiar de respuesta, saltos) nunca llega al CRM.
2. **El servidor decide.** Valida contra la **versión publicada**, calcula score/temperatura y
   resuelve el final y la redirección. Los pesos de scoring nunca viajan al navegador
   (`stripForPublic`). Un salto hacia atrás se ignora (sin bucles).
3. **Idempotencia.** `submission_id` es único por tenant: reenviar (doble clic, reintento, recarga)
   no crea otra fila ni repite efectos (contacto, webhooks).
4. **Redirecciones solo http(s)** (`safeRedirectUrl`); `{{trustpilot_url}}` sale de
   Configuración › Integraciones › Trustpilot, por subcuenta.
5. **Contactos según audiencia.** `captacion`/`cualificacion` crean o encuentran contacto;
   `alumnos` solo empareja por email y **nunca escribe en `contacts`** (el envío es anónimo: pisar
   `contacts.nps` corrompería un valor editable a mano). El NPS y las estrellas quedan en
   `form_responses` junto a formulario, módulo, clase y profesor, y se ven segmentados en Alumnos ›
   Feedback; `empleados` **no** crea contacto
   (las candidaturas no deben contaminar el CRM de ventas).
6. **PII.** Las respuestas se leen por rol (admin, director, manager, marketing; csm solo
   `alumnos`). Borrar: admin y director. Webhooks: solo admin y director; el secreto se guarda
   cifrado y se muestra una sola vez.
7. **Sin crons nuevos.** Los reintentos de webhooks cuelgan del cron diario `cron/reminders`
   (límite de Vercel Hobby).
8. **Los formularios públicos se incrustan** (`next.config.js` los excluye de `X-Frame-Options`,
   igual que `/embed`); el resto de la app no.

## Flujo de un envío público

`GET public/<slug>` (config sin scoring) → el motor registra la sesión (`session`, foto de estado) y
guarda parciales (`submit` con `partial`) → `submit` final: honeypot, tope de tamaño, tiempo mínimo,
rate limit → `evaluateSubmission` → contacto según audiencia → `upsert` idempotente →
`after()` envía webhooks → responde con final y redirección.

## Cómo añadir…

- **Un tipo de campo:** añádelo a `FIELD_TYPES` (types), `validateAnswer`, el `switch` de
  `components/forms/engine/Field.tsx`, `TYPE_LABELS` del constructor y a `schema.ts` si lleva
  propiedades nuevas.
- **Una plantilla:** función en `lib/forms/templates/index.ts` + entrada en `FORM_TEMPLATES` y en
  los grupos de la galería. `tests/forms-core.test.mjs` exige que sea publicable.
- **Un rol semántico:** `SemanticRole` (types), `schema.ts`, `extractSemantic`, el desplegable del
  constructor y, si alimenta otra pantalla, una columna en `form_responses`.

## Pendientes conocidos

- Migración `20261020120000_forms_csm_solo_alumnos.sql`: estrecha en BD lo que lee csm (la API ya
  lo aplica). Requiere confirmación antes de aplicarse.
- Evento canónico `form.enviado` (exige `TIPOS_DE_EVENTO` + migración `event_types` + test espejo).
- Atribución de toques (`registrarToque`) en captación de clientes.
- Subida de archivos (CV) y multi-idioma.
