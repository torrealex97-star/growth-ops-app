# Ledger de auditoría — hallazgos con ID estable

Los docs de auditoría point-in-time (`DASHBOARD_AUDIT.md`, `S0-*`, `ATTRIBUTION_AUDIT_REPORT.md`,
`FASE1-MATRIZ-INTEGRACIONES.md`, …) se conservan tal como se publicaron: son la evidencia del
momento. Este fichero es el **índice continuo**: cada hallazgo con vida más allá de la auditoría
que lo descubrió lleva aquí un ID estable y su estado actual.

## Protocolo (para cualquier auditoría futura)

1. **Un hallazgo, un ID.** Formato `Categoria-NN` (`PERF`, `INT`, `TRK`, `DEP`, `REF`, `SEG`, …).
   El ID nunca se reutiliza; un hallazgo nuevo toma el número siguiente. Si un hallazgo se parte
   en dos, cada parte gana ID propio referenciando al original.
2. **Nivel de evidencia** (vocabulario del repo, no otro): `INSPECTED` (leído en código/config) ·
   `TESTED` (ejecutado contra producción/BD) · `VERIFIED` (confirmado en el servicio real con
   resultado esperado). Un hallazgo no suma por estar bien escrito: suma por su evidencia, con
   fecha. La evidencia envejece: sin re-chequeo reciente queda `no re-chequeado` (con la fecha del
   último dato) — eso es «hay que revalidar», no «no pasa nada».
3. **Estados:** `nuevo` · `abierto` · `resuelto` (con PR/commit/migración y la evidencia que lo
   prueba) · `reabierto` · `no re-chequeado` · `no aplica` (criterio cambió). Los cambios de estado
   se registran junto al hallazgo, nunca borrando la fila.
4. **Distinciones obligatorias al reportar:** defecto confirmado ≠ por verificar ≠ mejora opcional
   ≠ diferencia intencional por diseño. Un hallazgo no se reparte en tres filas por el mismo
   defecto. No se inventan tres defectos en un sistema sano: si el máximo honesto es uno, se lista
   uno. Y un «hueco» no es un «cero»: si una fuente no se pudo leer, el hallazgo es esa imposibilidad.
5. **Lecturas cruzadas:** lo de conectores/sincronizaciones se cruza con
   [FASE1-MATRIZ-INTEGRACIONES.md](FASE1-MATRIZ-INTEGRACIONES.md) y
   [DIAGNOSTICO_SINCRONIZACIONES.md](DIAGNOSTICO_SINCRONIZACIONES.md); lo de rendimiento con
   [FREE_TIER_OPERATIONS.md](FREE_TIER_OPERATIONS.md). Este ledger no duplica sus contenidos:
   apunta a la fila o sección concreta.

> Los hallazgos de abajo se sembraron el 31-oct desde `ACTIVE_HANDOFF.md`, `PENDIENTES.md`,
> `FASE1-MATRIZ-INTEGRACIONES.md` y los `S0-*`, **sin re-validar uno a uno en producción en esta
> pasada** — cada fila lleva su estado de evidencia honesto. Las auditorías futuras actualizan
> aquí; no reescriben los docs viejos.

## Hallazgos abiertos (31-oct-2026)

| ID      | Hallazgo                                                                                                                                                                                                                                        | Evidencia                                               | Estado                                                      | Próximo paso / bloqueo                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01 | Patrón de acceso a `appointments`: los quals con OR entre roles impiden un índice para `ORDER BY … LIMIT`; hoy seq scan + filtro cuesta 10–17 ms con ~800 filas y el riesgo es crecer linealmente con el volumen.                               | `TESTED` (EXPLAIN + pg_stat_statements, 27-oct)         | `abierto` (no urgente)                                      | Rediseño del shape (policy por cajas de acceso o función de visibilidad indexable) cuando la tabla crezca. Detalle en `PENDIENTES.md`. |
| TRK-01  | `identify` visitante→contacto nunca escribe: la landing (GHL) no carga `embed/loader.js` ni el player; sin identidad ni evento pixel no hay stitching. Parte (b) del arreglo es código propio: `loader.js` emite `window.gop('lead', {email})`. | `TESTED` (diagnóstico en producción, 23-oct)            | `abierto` (bloqueado por el dueño: editar el funnel de GHL) | Dueño edita la landing para cargar el iframe/embed + loader.js; la parte (b) es la siguiente tarea de código pendiente.                |
| INT-01  | Tokens de Meta/Instagram caducados o sin `ads_read`: 20 y 9 runs en error (fuente: matriz 6-oct).                                                                                                                                               | `TESTED` (fallo reproducido, 6-oct) · `no re-chequeado` | `abierto` (bloqueo humano)                                  | Re-pegar token con `ads_read` en Integraciones y verificar siguiente run; re-verificar frescura de esta fila.                          |
| DEP-01  | SDK `@anthropic-ai/sdk` 1.x sin migrar (Dependabot lo ignora desde #649). Toca `lib/ai/provider.ts`; la 1.x quita `temperature` de `messages.create`.                                                                                           | `INSPECTED`                                             | `abierto`                                                   | Migrar a mano con CI verde antes de fusionar; el propio provider testea su output.                                                     |
| REF-01  | Devoluciones acumuladas sin tope automático ni idempotency key; el clawback espejo de comisiones escala sobre parciales repetidos (`refunds/create` + `lib/commissions/calculator.ts`).                                                         | `INSPECTED`                                             | `abierto` (bloqueado por decisión Alex A/B/C)               | Decisión pendiente en [DECISIONES-PENDIENTES-ALEX.md](DECISIONES-PENDIENTES-ALEX.md) → tras decidir, ~1 sesión + tests.                |
| RUN-01  | Un timeout que mata la función no deja fila en `integration_sync_runs` (el run de las 13:57 no consta).                                                                                                                                         | `TESTED` (28-sep) · `no re-chequeado`                   | `abierto` (verificar antes de actuar)                       | Puede estar reparado por los crons con `truncated` del 25–28-sep: re-verificar antes de invertir.                                      |

## Resueltos (para el histórico, solo la fila abre/cierra)

- (ninguno por ahora: el ledger arranca el 31-oct; los cierres futuros se anotan aquí con fecha,
  `commit` y, si aplica, el check de regresión que lo demostró.)
