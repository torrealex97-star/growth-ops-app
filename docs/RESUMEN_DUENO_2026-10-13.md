# Resumen para el dueño — 13 de octubre de 2026

Lo que entró hoy a `main` (PRs #493-#503, todas con CI verde y revertibles individualmente) y las
decisiones que solo tú puedes tomar para desbloquear lo que sigue. Detalle técnico en las
auditorías fusionadas; aquí va lo que afecta al negocio.

## 1. Lo que ganó la plataforma hoy

**Tracking y auditabilidad de la operación**

- Motor de señales de negocio `lib/growth/signals.ts` (SPEC-15): detector determinista de caídas
  de Show Rate con guardas honestas (no inventa alertas cuando faltan outcomes) — el primer
  bloque del sistema de automatización controlada con aprobación humana.
- Motor de anomalías y notificaciones ya existentes consolidados en una auditoría con su delta.

**Seguridad de plataforma (lo que te deja crecer sin vender tu niebla)**

- Matriz de RBAC de plataforma [lib/platform/rbac.ts](lib/platform/rbac.ts) (SPEC-16): fail-closed
  con 9 tests adversariales — un usuario de tenant, por más admin que sea, no toca acciones de
  plataforma; sin jerarquía aprobada, nada se auto-aprueba.
- Aislamiento RLS **verificado en modo live** (no solo mocks): la sonda `test:rls:live`,
  autorizada por ti, PASS en SELECT/INSERT/UPDATE/DELETE entre dos subcuentas y con usuario dual.
- Cifrado de secretos estabilizado por Codex (#499): `CONFIG_ENC_KEY` obligatoria con huella
  HMAC por secreto y diagnóstico para admins sin exponer material.

**Velocidad y eficiencia de la app**

- Fix real de rendimiento (SPEC-17): el reparto de presupuesto de los crons ahora está anclado al
  deadline global (helper `lib/perf/presupuesto-cron.ts`); antes, con muchas subcuentas, un
  backfill podía estirar el run `n × presupuesto` y tumbar el cron con 504 (el caso que ya mató a
  calendly-ghl en producción). Cableado en los crons de recordatorios y gastos mensuales.

**Decisión de lanzamiento emitida (no es una checklist documental)**

- Certificación final (SPEC-18): **NOT_READY para lanzamiento público/comercial** y
  **CONDITIONAL_READY para el alcance que ya opera** — [FINAL_LAUNCH_CERTIFICATION_REPORT.md](FINAL_LAUNCH_CERTIFICATION_REPORT.md)
  con los 18 gates, la evidencia de cada uno y el siguiente paso exacto (sin checklist documental:
  cada estado sale de su evidencia, no de marcar casillas).

## 2. Decisiones BUSINESS en tu mesa

Ordenadas por lo que desbloquean (1ª primero — es la que convierte la plataforma en SaaS comercial):

| #   | Decisión                                                                                                         | Dónde está planteada                                                                                        | Qué desbloquea                                                                     | Riesgo de no decidir                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **Billing SaaS propio**: qué planes vende el producto, precios, y modo de cobro (¿Stripe del SaaS?)              | SPEC-13 §5 + [SAAS_ADMIN_ARCHITECTURE_AUDIT.md](SAAS_ADMIN_ARCHITECTURE_AUDIT.md) §5, PR-2/3 de SPEC-16     | G6 (billing), directorio de tenants con «plan», alta self-serve, control de cobros | La plataforma NO puede cobrar/suspender por impago: todo manual, no escala       |
| 2   | **Jerarquía de roles de plataforma** (owner/admin/soporte/cs/billing/auditor — o quedarte con el binario actual) | [SAAS_ADMIN_ARCHITECTURE_AUDIT.md](SAAS_ADMIN_ARCHITECTURE_AUDIT.md) §4                                     | PR-1 real de admin (tickets, soporte templado sin acceso universal)                | La matriz v0 queda fail-closed por completo; sin tickets de soporte reales       |
| 3   | **A5 — devoluciones acumuladas + idempotencia de clawback**                                                      | [DECISIONES-PENDIENTES-ALEX.md](DECISIONES-PENDIENTES-ALEX.md) §1 (recomendación: A, automático, ~1 sesión) | Riesgo de doble devolución se cierra tal cual                                      | Devoluciones repetidas no detectadas a tiempo                                    |
| 4   | **Dos firmas concurrentes con el mismo token** (contratos)                                                       | idem §2                                                                                                     | firma de contratos robusta bajo clic-doble                                         | Potencial duplicidad de contrato firmado                                         |
| 5   | **Onboarding de alumno sin outbox** (fallo de GHL tras firmar)                                                   | idem §3 (A: outbox coordinado con la F1 del plan; B: botón puente)                                          | fiabilidad del alta de alumnos                                                     | alumnos «firmados» que no llegan a GHL sin rastro re-disparo                     |
| 6   | **Staging independiente** (segundo proyecto Supabase) para QA/E2E aislados de producción                         | [FINAL_LAUNCH_CERTIFICATION_REPORT.md] G8/G10/G15, [ACTIVE_HANDOFF.md] K                                    | pruebas de carga (G15), cliente MCP live (G10), integraciones auditadas (G8)       | Los gates en vivo quedan sin certificar: el lanzamiento comercial sigue NO_READY |
| 7   | **Retención de raw/transcripciones** (política de producto, no código)                                           | [S1-MVP-READINESS](S1-MVP-READINESS-2026-10-01.md) F6; map PII listo                                        | G17 completo (RGPD si lo quieres declarar)                                         | retención sin política: no se puede graduar ni prometer borrado                  |

## 3. Cómo decidir

El formato que ya usó el repo para las 3 de [DECISIONES-PENDIENTES-ALEX.md](DECISIONES-PENDIENTES-ALEX.md):
responde en una línea («A5: X · Firma: X · Onboarding: X») y el carril del repo ejecuta en ese
orden. Para las de la tabla de arriba, la 1 y la 2 definen si la app se convierte en SaaS con
cobro propio: son decisiones de dirección, no se ejecutan solas.
