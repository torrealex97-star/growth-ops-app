# SPEC-15 — Autonomous Growth Operations · Auditoría PR-0

13-oct-2026 · Buffy · rama `feat/spec15-pr0-automation-audit` sobre `origin/main`.

**Método.** Cada componente se mapea primero a su equivalente real con evidencia:
fichero, lógica y pruebas. Lo que no existe queda como delta con su fase. La regla final
del prompt pidió no limitarse a documentación: este PR incluye además el primer slice real
de PR-1 (`lib/growth/signals.ts` + `tests/growth-signals.test.mjs`, puro y testeado).

## 1. Mapa motor → repositorio real

| Componente del §4                 | Equivalente real hoy                                                                                                                                                                                                                                                                                                            | Estado         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Signal Detector                   | `lib/ai/insights/detectors.ts`: comparación determinista con ventanas de 7 días, fingerprint semanal para dedup, y fail-closed ante lectura fallida (nunca compara contra un cero fabricado). Corre como cron `ai-insights`.                                                                                                    | READY_VERIFIED |
| Opportunity Engine                | Hueco. Las anomalías del detector llegan al Growth Brief y al popover de Notificaciones (`components/os/Header.tsx`, carga al abrir), pero no se persisten como oportunidades con contexto y estados.                                                                                                                           | PARTIAL → PR-1 |
| AI Analysis Layer                 | `lib/ai/agent/{gateway,tools,growth-operator}.ts`: frontera de autoridad probada (lista blanca con clases lectura/escritura_memoria/accion_material, tenant fijo server-side, sin SQL libre), 16 tools de solo lectura con LIMIT.                                                                                               | READY_VERIFIED |
| Action Planner                    | No existe: el Copilot explica, no propone acciones persistidas.                                                                                                                                                                                                                                                                 | MISSING → PR-5 |
| Policy Engine                     | Cada ruta decide su política a mano (`requireTenant`, `requirePantalla`); no hay registro de riesgo/scope/límite por tipo de acción.                                                                                                                                                                                            | PARTIAL → PR-2 |
| Workflow Engine / Lifecycle       | Tres colas humanas reales ya testeadas: `pending_validacion` de facturas importadas, `needs_commission_review` de cobros (`collections/approve-review` recuperable con test), `fathom_match_review` (idempotente por tenant+meeting). Falta la máquina de estados genérica con expiración, binding de payload y control TOCTOU. | PARTIAL → PR-3 |
| Action Executor                   | Crons deterministas con claim atómico antes del efecto (backfill de YouTube), deadline que gobierna todas las llamadas externas, upsert idempotente con resume. No existe el motor de acciones externas con lock + idempotency key + provider_reference.                                                                        | PARTIAL → PR-6 |
| Provider writes                   | Lecturas y espejos listos; escrituras event-intensive via webhooks internos (GHL/Calendly entrantes) y sync de agenda. No hay adaptadores de acción con verificación post (regla 18: respuesta perdida ≠ éxito).                                                                                                                | PARTIAL → PR-7 |
| Result Verifier / Outcome Tracker | Hueco. Data Health verifica lo técnico (checks, actas); la medición del resultado de negocio de una acción no existe.                                                                                                                                                                                                           | MISSING → PR-8 |
| Audit log                         | `audit_logs` extendido con motivo obligatorio en 40+ rutas críticas; escrituras con `{ error }` comprobado por tests de CI.                                                                                                                                                                                                     | READY_VERIFIED |
| Notifications                     | Popover de `components/os/Header.tsx` (carga al abrir, deliberado), Growth Brief, bandeja por tenant. Sin push de eventos del motor, sin dedupe, sin preferencias.                                                                                                                                                              | PARTIAL → PR-9 |
| Human Task system                 | Tabla `tasks` con CRUD y UI (`app/[tenant]/tasks/page.tsx`, `app/api/[tenant]/evergreen/tasks/route.ts`).                                                                                                                                                                                                                       | READY_VERIFIED |

Regla aplicada: nada de esto se reescribe. Los MISSING/PARTIAL se construyen encima del patrón
existente indicado.

## 2. Matriz de capacidades

| Capacidad       | Existe  | Implementación real (evidencia)                                                | Reutilizable                        | Riesgo                                                                                         | Cambio necesario |
| --------------- | ------- | ------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------- |
| AI tool calling | SÍ      | 16 tools de solo lectura con límites y tenant fijo server-side                 | CANONICAL READ TOOLS del motor      | el Copilot jamás eleva permisos; PR-5 añade salida estructurada validada sin tocar la frontera | PR-5             |
| Action Center   | PARCIAL | Tareas completas + anomalías en popover                                        | base de Erfahrung visual del centro | falta el ciclo recommendation→approval→execution→measurement                                   | PR-4             |
| Jobs            | SÍ      | 12 crons con deadline interno, actas en `integration_sync_runs`, claim atómico | patrón claim/deadline exacto        | presupuestos: todo job nuevo ≤45 s con maxDuration 60                                          | PR-6             |
| Approvals       | PARCIAL | las 3 colas humanas descritas arriba                                           | molde del motor genérico            | falta expiración, binding de payload y separación de funciones                                 | PR-3             |
| Provider writes | PARCIAL | webhooks entrantes y sync; sin adaptadores de acción con verify                | webhooks como base                  | proveedor acepta y la respuesta se pierde: sin provider_reference se duplicaría el efecto      | PR-7             |
| Audit log       | SÍ      | extendido, motivo obligatorio, fail-ruidoso testado                            | directo                             | ninguna ejecución nueva sin audit                                                              | PR-6             |
| Notifications   | PARCIAL | popover + brief + bandeja                                                      | render existe                       | push automático con dedupe pendiente (PLAN §3.3 ya lo diseña)                                  | PR-9             |

## 3. Cumplimiento de las reglas innegociables en el slice PR-1 (incluido en este PR)

- **No duplicar Data Health (regla 3):** el detector devuelve `not_evaluable` cuando el estado de
  sincronización o la cobertura no permiten leer la señal; nunca emite una caída desde datos
  degradados.
- **No duplicar el Copilot (regla 4):** el LLM no entra en la capa de señales; el slice es 100 %
  determinista. La IA solo explicará señales ya detectadas (como en `detectors.ts`).
- **No inventar (reglas 12-13):** las guardas de muestra mínima, ventana comparable y cobertura
  de outcomes están testeadas — las pruebas demuestran que una "caída" aparente con outcomes
  desconocidos NO produce señal.
- **No duplicar jobs (regla 5):** sin cron nuevo en este PR; la persistencia y el scheduling son
  de PR-3/PR-6 con la decisión del usuario sobre la tabla.

## 4. Plan de remediación (delta real del §29)

| Fase                                   | Cubre                                                                                                                                                                     | Nota                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **PR-0** (esta)                        | Matriz + slice PR-1 iniciado                                                                                                                                              | código + tests                               |
| PR-1 — Signal & Opportunity Contracts  | completar: detector Show Rate + cobertura de fuentes Meta/CRM; persistencia `growth_signals` SOLO con aprobación del usuario y RLS + tests adversariales (§22 del prompt) | slice base ya entregado                      |
| PR-2 — Action Registry & Policy Engine | taxonomía A-E declarada en datos; el modelo nunca eleva riesgo (regla 8)                                                                                                  | —                                            |
| PR-3 — Lifecycle & persistence         | máquina de estados con expiración, payload-pinned y TOCTOU (molde: `fathom_match_review`)                                                                                 | —                                            |
| PR-4 — Action Center UI                | vista por estado sobre `tasks` + recomendaciones                                                                                                                          | —                                            |
| PR-5 — AI Action Planner               | salida estructurada validada; la IA propone, el esquema decide `requires_approval`                                                                                        | —                                            |
| PR-6 — Deterministic Executor          | lock + idempotency key + provider_reference sobre el patrón claim/deadline                                                                                                | —                                            |
| PR-7 — Safe adapters                   | GHL tareas/notas con verify-after-write; árboles de scopes documentados                                                                                                   | requiere documentación oficial del proveedor |
| PR-8 — Outcome tracking                | baseline separada de hipótesis (§19); estados NOT_YET_MEASURABLE…INCONCLUSIVE                                                                                             | —                                            |
| PR-9 — Briefings & Notifications       | push con dedupe, timezone, preferencias                                                                                                                                   | —                                            |
| PR-10 — E2E & Security                 | fixtures 1-40 del §27 + adversarial multi-tenant (§22)                                                                                                                    | —                                            |

## 5. Riesgos pendientes de decisión

1. **Tabla nueva `growth_signals`** (y familia del §10 del prompt): se crea solo con aprobación
   del usuario, RLS de la casa y batería adversarial. El slice PR-1 no la necesita.
2. **Escritura a proveedores:** sin documentación oficial verificada de scopes/operaciones de GHL
   no se implementa PR-7; queda bloqueada por decisión/documentación, no por código.
3. **Coste de evaluaciones LLM:** el detector es determinista y gratis; cada propuesta de PR-5
   debe dejar el margen de crons intacto (`FREE_TIER_OPERATIONS.md`).
