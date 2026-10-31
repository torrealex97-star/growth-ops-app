# Log de decisiones (append-only)

Registro incrementable de decisiones del producto y de la coordinación de agentes. Cuando se decide
algo no trivial (negocio, arquitectura, operación), se añade una entrada al final; nunca se edita
una entrada ya escrita — para corregir, entrada nueva que referencia a la anterior.

`main` es la fuente de verdad del código, Supabase la de los datos y `docs/plan/` la hoja de ruta;
este log no duplica estado: guarda el **por qué** de cada decisión.

Formato por entrada:

    ## AAAA-MM-DD — Título corto

    **Decisión:** qué se decidió.

    **Por qué:** razonamiento, restricciones y qué haría cambiar de opinión.

    **Alternativas consideradas:** qué estaba sobre la mesa.

    **Owner:** quién responde.

---

## 2026-10-31 — Adoptar log de decisiones append-only + ledger de auditoría con IDs estables

**Decisión:** `docs/decisions/log.md` (este fichero) queda como registro único de decisiones, y
[docs/AUDIT_LEDGER.md](../AUDIT_LEDGER.md) como ledger con IDs estables de hallazgos de auditoría.
El panel de «Fuentes/conectores» dentro de la app NO se construye: su equivalente ya existe
(`integration_sync_runs`, página de Integraciones y Data Health).

**Por qué:** el «por qué» de las decisiones estaba disperso entre `docs/ACTIVE_HANDOFF.md`,
`docs/DECISIONES-PENDIENTES-ALEX.md` y ADRs sueltos; y los docs de auditoría point-in-time
(`DASHBOARD_AUDIT`, `S0-*`, …) no rastreaban sus hallazgos entre revisiones. La mecánica se toma de
<https://github.com/nateherkai/AIS-OS> (MIT): solo la mecánica — «Three Ms» / «Four Cs» son marcas
de Nate Herk y no se adoptan.

**Alternativas consideradas:** (1) migrar la estructura de carpetas del kit completo — descartada:
`docs/plan/` ya es la hoja de ruta canónica y duplicarla viola el propio AGENTS.md; (2) registrar
conectores en un doc nuevo de conexiones — descartado: `docs/FASE1-MATRIZ-INTEGRACIONES.md` ya es
ese registro y la app ya pinta estado por conector.

**Owner:** Alex (decisión de adopción, 31-oct; implementación: Buffy).

---

## 2026-10-31 — Los hallazgos de auditoría viven en el ledger, no en reescribir los docs viejos

**Decisión:** los docs de auditoría ya publicados (`DASHBOARD_AUDIT.md`, `S0-*`,
`ATTRIBUTION_AUDIT_REPORT.md`, …) no se reescriben ni consolidan a posteriori: quedan como evidencia
point-in-time, y cada hallazgo que sigue vivo se lista en `docs/AUDIT_LEDGER.md` con su ID estable y
estado. Los hallazgos nuevos de auditorías futuras se añaden al ledger en el momento, no en un
doc ad hoc nuevo.

**Por qué:** las auditorías previas dejaron hallazgos abiertos cuyo seguimiento dependía de leer el
relevo de cada sesión; el tablero es estado de SUBIDA, no histórico de hallazgos. Un ledger con
IDs da continuidad sin tocar la evidencia original.

**Alternativas consideradas:** un doc consolidado que reescriba todas las auditorías — descartado:
destruye la trazabilidad de cada evidencia original y es trabajo grande de bajo valor.

**Owner:** Buffy (implementa), Alex (aprueba la práctica para futuras auditorías).
