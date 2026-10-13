# SPEC-18 — Informe final de certificación de lanzamiento

Fecha: 13-oct-2026 · Evaluador: Buffy (Freebuff), PR-0 de SPEC-18 · SHA evaluado: `b13e9041` (main,
CI verde #498) · Alcance evaluado: **dos niveles explícitos** (ver §M) con evidencia citada de las
PRs #479-#498 y de las suites ejecutadas hoy. Método: DISCOVER→INVENTORY→TRACE→TEST→CERTIFY; un
NOT_READY bien fundamentado también es un resultado válido (regla de la SPEC).

## A. Executive Summary

Growth Operator OS **está preparado para seguir operando tal como opera hoy** (plataforma tensa
por 1 dueño + equipo interno, aislamiento RLS probado adversarialmente, dinero canónico con
refunds, webhooks idempotentes, auditoría en 40+ rutas, cero P0 de seguridad confirmado) pero
**NO está preparado para un lanzamiento público SaaS self-serve con clientes de pago de manera
general** — le falta el bloque comercial completo (billing propio, entitlements, alta self-serve,
soporte con jerarquía de staff) y el control DR de restauración nunca ha sido ejecutado.

## B. Release Candidate evaluada

`b13e9041` en `main` (merge #498). Rama: main. Entornos: producción opcionalmente vigente para el
dueño (app.scalixsystems.com) y CI. Responsable de decisión: Alex (dueño). NO se desplegó nada
nuevo en esta PR: solo documentos + módulo puro de gates con tests.

## C. Architecture Reality

Resumen en [FINAL_REPOSITORY_INVENTORY.md](FINAL_REPOSITORY_INVENTORY.md). Arquitectura canónica:
raw_events → canonical_events → proyecciones; cash único con refunds; atribución con evidencia;
actas auditadas. En cuanto a la fuente única por concepto: NINGUNA divergencia grave conocida
(solo falta el motor común de clasificadores de fuente, H-1 de SPEC-05).

## D. Module Status (14)

Matriz en [SPEC_TO_CODE_TRACEABILITY.md](SPEC_TO_CODE_TRACEABILITY.md):
9 módulos PARTIALLY_IMPLEMENTED (con pruebas reales), 5 con huecos concretos y ninguno vacío;
3 módulos con BLOCKED por decisión del dueño (billing.business, staff hierarquía,
growth_signals DDL). Ninguno está vacío o sin especificar.

## E. Test Results de hoy (comando, entorno, commit, resultado)

| Comando                | Entorno                                                       | Commit                 | Resultado                                                        | Duración       |
| ---------------------- | ------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- | -------------- |
| `npm test`             | local macOS, base en memoria                                  | `d0addd5b` (rama PR-0) | 1682/1682 PASS, 0 skipped                                        | 8 s            |
| `npm run test:metrics` | local, sin credenciales (suite de métricas por loader propio) | _idem                  | 788/788 PASS                                                     | 9 s            |
| `npm run quality`      | local                                                         | _idem                  | PASS                                                             | incluido en CI |
| CI del SHA fusionado   | GitHub Actions                                                | `b13e9041`             | VERDE (Build, FLTC+dead code, Smoke E2E 5m31s, gitleaks, Vercel) | —              |

Limitaciones declaradas: sin base producción live (credenciales borradas por higiene del hilo);
`npm run test:rls:live` no se pudo ejecutar esta vez (requiere refrescar credenciales y dueño).
La batería adversarial estática 11/11 está integrada en `npm test`.

## F. Defects Críticos

- **P0 confirmado: 0.** (El escáner de fugas y la batería adversarial están en CI; ninguna
  apertura cross-tenant confirmada).
- P1 abiertos: billing SaaS MISSING; restore drill UNVERIFIED; MCP sin cliente verificado;
  jerarquía de staff pendiente; generificaciones del sinónimo «direcciones» resuelto con matriz
  fail-closed.
- P2: H-1 raw_events Calendly; consultas top `appointments` (mitigada en `20261006090000`
  pendiente de verificar en EXPLAIN); clasificadores de fuente; Action Center unificado.

## G. Launch Gates (G1–G18)

| Gate | Requisito               | Evidencia                                                                                                                     | Estado                                      |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| G1   | Auth + tenant isolation | batería 11/11 en `npm test`, escáner en CI, excepción resource_links documentada                                              | **PASS (la batería en CI es la evidencia)** |
| G2   | Data integrity          | cash/dedup/refunds probados; raw_events (GHL+Stripe sí, Calendly NO)                                                          | **CONDITIONAL**                             |
| G3   | Attribution             | tests de atribución + resolver PROBADOS, múltiples superficies                                                                | CONDITIONAL (sin motor común de fuente)     |
| G4   | Revenue & Cash          | canonicalCash + tests de ingestion and duplicates                                                                             | **PASS (scope interno)**                    |
| G5   | Onboarding SaaS         | aprovisionador interno probado; self-serve MISSING                                                                            | **BLOCKED (decisión business)**             |
| G6   | Billing SaaS            | MISSING (grep 0 de plataforma en #483)                                                                                        | **FAIL (comercial)**                        |
| G7   | Dashboards/KPI          | 74 ficheros de métricas PASS                                                                                                  | **PASS**                                    |
| G8   | Integraciones           | Meta/GHL/Calendly/Stripe vivas para el dueño (LIVE_READ_ONLY observado); sandbox y escrituras reales no auditables desde repo | **CONDITIONAL**                             |
| G9   | AI                      | contenido hostil 12 tests + listas blancas; eval dataset MISSING                                                              | **CONDITIONAL**                             |
| G10  | MCP                     | servidor OAuth completo; cliente live sin prueba                                                                              | **UNVERIFIED (live)**                       |
| G11  | Automations             | señales fail-closed probadas; ejecutor de aprobaciones pendiente DDL                                                          | **BLOCKED**                                 |
| G12  | Platform Admin          | RBAC fail-closed PROBADO; jerarquía BUSINESS pendiente                                                                        | **CONDITIONAL**                             |
| G13  | Backups/DR              | restore drill NUNCA ejecutado                                                                                                 | **FAIL (P1)**                               |
| G14  | CI/CD                   | CI + rollback documentado; prod desplegadas por PR                                                                            | **PASS**                                    |
| G15  | Performance             | presupuesto de crons medido y corregido; sin pruebas de carga largas                                                          | **UNVERIFIED (escalado)**                   |
| G16  | Observability           | audit_logs, actas, advisors manuales; sin alertas automáticas                                                                 | **CONDITIONAL**                             |
| G17  | Privacy                 | erase_person probado; retención sin política de producto decidida                                                             | **CONDITIONAL**                             |
| G18  | UX                      | QA parcial #484; visual regression pendiente                                                                                  | **CONDITIONAL**                             |

## H. Riesgos y controles compensatorios

- Riesgo comercial sin billing: hoy solo cobran a mano fuera de sistema; la plataforma no puede
  suspender automáticamente por impago (control: proceso manual del dueño).
- Riesgo DR: sin prueba de restauración exitosa (control: exportación manual antes de migraciones
  documentada en FREE_TIER_OPERATIONS).
- Riesgo de personal: acceso total para el dueño único (control: toda está auditada; nada se
  activa fuera del dueño).

## I. Performance & Capacity

VSO p50/p95 measured: NO DISPONIBLE (sin staging). Único dato medido reutilizables de bases de
producción del dueño (carga real de este año) y presupuesto del helper de crons (PR #497).
Ninguna cifra de "soporta N tenants" se declare: hipótesis no probadas.

## J. Security & Privacy

PASS en CI: gitleaks, batería adversarial; sin excepción abierta conocida (resource_links está
documentada como decisión del dueño). Privacidad: erase_person probado, mapa PII hecho, sin
política de retención
finalizada. No se declara cumplimiento RGPD/SOC2/ISO: falta el proceso formal, no lo presenta el
repo (regla 17 y §27 de la SPEC).

## K. Operations

CI/CD real en verde; despliegue por PR con `Release gate`. Backups: exportación manual documentada
(sin drills). Runbooks existentes (docs/runbooks/* limitados a incidentes actuales conocidos) y
presupuestos asociados a los crons ya codificados. Alertas (automáticas) niegan con criterio
NOT_VERIFIED.

## L. Commercial Readiness

Alta de clientes es MANUAL (super admin crea subcuenta, invita y verifica en pantalla #494);
si la comercialización de pago exige Billing SaaS + self-serve + entitlements + staff jerárquico:
FALTA TODO — y es bloqueante para cualquier cobro automático (y para riesgo de novación).

## M. Decisión (algoritmo §44 aplicado)

```text
IF violation crítica de seguridad confirmada → NO
CASE failure de isolation confirmado → NO
CASE integridad financiera rota → NO (cash probado; no inventario fantasma)
CASE flujo comercial obligatorio falla → SÍ (billing + self-serve ausentes)
    ⇒ NOT_READY para el ALCANCE COMERCIAL self-serve
CASE evidence suficiente para lanzamiento público → INSUFICIENTE (DR + staging + carga)
    ⇒ NOT_READY para lanzamiento público de alcance completo
CASE riesgos acotados aprobados y alcance limitado → SÍ, con monitoreo y dueño
    ⇒ CONDITIONAL_READY para exactly DOS alcances acotados descrito abajo.
```

**DECISION — CONDITIONAL_READY, con alcance explícito:**

1. **Internal Alpha / operación actual (YA AUTORIZADA por el dueño hoy):** plataforma operada por
   el dueño + equipo interno con clientes reales REALES aquí al momento. La app sigue funcionando
   con el aislamiento de tenants verificado y el dinero canónico. Sin cambio de alcance.
2. **Private Beta con clientes seleccionados (requiere aprobación humana EXPRESA del dueño y
   cumplir los 4 requisitos de CONDITIONAL_READY):** el dueño firma el plan de control
   compensatorio (recuento: alta manual + sin cobros automáticos + DR semi-automático con
   export + staff único + monitoreo por actas de Audit log y Data Health + plan de salida
   documentado). NO se puede usar Private Beta para afirmar certificación pública.
3. **Public Launch (NOT_READY):** hasta completar G6 (billing), G5 (borrón self-serve),
   G10/G13/G15 en un entorno con staging. Responsable: el dueño; los PRs de SPEC-16 §5 y
   SPEC-13 §5 listan los desbloqueos.

## N. Remaining Work priorizada

1. Decisión BUSINESS billing SaaS (desbloquea PR-2/3 de SPEC-16 y CI G6).
2. DR drill ejecutado y documentado (G13).
3. Staging y RLS live re-verificados con credenciales (G1/G8 live).
4. Motor común de clasificadores de fuente (H-1 de SPEC-05) — integridad de atribución.
5. Calendly → raw_events (H-1 de SPEC-04) — falta de evidencia del canal más vibrante.
6. MCP cliente real probado (PR-10 SPEC-11). 7. Action Center unificado. 8. Dataset de evaluación IA.

## O. Evidence Index

- Suites de hoy: `/tmp/spec18-test.txt`, `/tmp/spec18-metrics.txt` (artefactos de sesión).
- CI: runs de SHA `b13e9041` y merges #494/#497/#498 verdes.
- Auditorías base: PRs #479–#487, #493 (#4739 fusiones), #494, #497, #498.
- Módulo de decisión del algoritmo: `lib/launch/gates.ts` + `tests/launch-gates.test.mjs` (en esta PR).
