# Runbook: backup y restore drill

## Hallazgo del 14-oct-2026: hoy NO hay backups automáticos

Comprobado: la organización de Supabase está en el plan **Free** (`get_organization` → `plan: free`).
Según la documentación de Supabase, los backups diarios son de los planes **Pro/Team/Enterprise**; en Free
recomiendan exportar con `supabase db dump` y guardar copias fuera. En este repo no existe ningún workflow ni
script de volcado. Es decir: ante un borrado accidental, una migración errónea o la pérdida del proyecto, **no hay
de dónde restaurar**. El resto de este documento (RPO/RTO) solo vale una vez que exista alguna de las opciones B/C.

Tamaño real: base de datos 52 MB (33 MB en `public`), Storage 15 MB en 5 objetos. Es pequeño: cualquier opción cabe.

### Opciones (decisión del dueño)

|             | A · Supabase Pro                       | B · Volcado nocturno propio                      | C · A + B                       |
| ----------- | -------------------------------------- | ------------------------------------------------ | ------------------------------- |
| Coste       | 25 USD/mes (+ cómputo)                 | 0 USD (GitHub Actions + almacenamiento gratuito) | 25 USD/mes                      |
| RPO         | 24 h (7 días de copias)                | 24 h (retención a elegir)                        | 24 h, dos copias independientes |
| Restaurar   | Panel: «Restore to new project»        | `psql`/`pg_restore` a un proyecto nuevo          | cualquiera                      |
| Protege de… | Fallo/borrado dentro de Supabase       | Además: pérdida de cuenta/proyecto (copia fuera) | Todo                            |
| No cubre    | Storage (objetos) y PITR (no incluido) | Storage salvo que se añada                       | —                               |
| Esfuerzo    | 5 min                                  | ~1 sesión (workflow + 2 secretos)                | A + B                           |

Recomendación: **B ya** (cuesta 0 y es lo único que protege de perder el proyecto) y **A cuando se empiece a
cobrar o se abra al público** (los gates de lanzamiento lo exigen). PITR (100 USD/mes) no compensa a este tamaño.

### Dónde restaurar el drill (respuesta corta)

En un **segundo proyecto Supabase Free** (el plan Free permite dos proyectos): coste 0, aislado de producción y
sirve además de staging para G8/G10/G15. Alternativa sin cuenta: un Postgres 17 local con Docker.

## Opción B implantada (15-oct-2026)

Workflow `.github/workflows/backup-nocturno.yml`: cada noche 03:30 UTC, `pg_dump` (schemas `public` y `auth`),
comprobación de que el volcado lista ≥20 tablas con datos, cifrado AES-256 con gpg y subida como artifact con
retención de 30 días. El repo es público, por eso va cifrado y nunca se imprime.

Requiere dos secretos del repo: `BACKUP_DATABASE_URL` (cadena del pooler) y `BACKUP_PASSPHRASE`. Guarda la frase
en el gestor de contraseñas: sin ella la copia no se puede abrir.

Restaurar: descargar el artifact, `gpg --decrypt backup.dump.gpg > backup.dump` y
`pg_restore --no-owner -d <proyecto-nuevo> backup.dump` (nunca contra producción). No cubre Storage (15 MB).

## Qué backups existen hoy

Gestionados por Supabase a nivel de plataforma (no hay ningún script propio en este repo, y no debería haberlo —
reimplementar backups a mano sería reinventar algo que la plataforma ya cubre). **NEEDS_VERIFICATION antes de
confiar en esto**: entra al dashboard de Supabase → Settings → Database → Backups, y confirma:

- Qué plan está contratado (Free/Pro/Team) y qué retención de backups incluye.
- Si Point-in-Time Recovery (PITR) está activo (solo en planes de pago) — si lo está, el RPO real puede ser de
  minutos en vez de las 24h que este documento asume por defecto.

## RPO (Recovery Point Objective) propuesto

**24 horas** como objetivo mínimo aceptable, asumiendo backup diario estándar. Ajustar a la baja (sin coste
adicional de proceso) en el momento en que se confirme que PITR está activo — en ese caso el RPO real pasa a ser de
minutos.

## RTO (Recovery Time Objective) propuesto

**4 horas** desde que se decide restaurar hasta que la app vuelve a estar operativa (restaurar Supabase + verificar

- redeploy de Vercel si hiciera falta). No hay infraestructura propia (colas, servicios stateful) que alargue esto
  más allá del tiempo que tome la restauración de la base de datos en sí.

## Restore drill — procedimiento seguro (NUNCA contra producción)

1. **Obtener backup**: desde el dashboard de Supabase del proyecto de producción, solicitar una restauración a un
   **proyecto Supabase nuevo y aislado** (no al mismo proyecto) — Supabase soporta esto para planes con backups.
2. **Restaurar en entorno aislado**: confirmar que el restore apunta al proyecto de prueba, nunca al de producción.
3. **Ejecutar validaciones**:
   - `SELECT count(*) FROM tenants;` — deben aparecer `evergreen` y `women-digital-closer`.
   - `SELECT count(*) FROM sales WHERE tenant_id = '<evergreen_id>';` y lo mismo para WDC — deben ser números
     razonables, no cero (un backup vacío es peor que no tener backup, porque da falsa confianza).
4. **Comprobar integridad**: correr `EXPLAIN` o un `SELECT` simple sobre las tablas con RLS (`sales`, `contacts`,
   `collections`) usando un usuario de prueba de cada tenant — confirmar que el aislamiento sigue intacto tras el
   restore (las políticas RLS viajan con el schema, pero verificarlo es barato y evita sorpresas).
5. **Comprobar métricas**: cargar `lib/finance/pnl.ts` con datos del proyecto restaurado (o correr la query
   equivalente a mano) para un mes conocido, y comparar contra lo que se recuerde/documente del dashboard real de
   ese mismo mes — una discrepancia grande indica que el backup no es lo que se pensaba.
6. **Documentar resultado**: fecha del drill, cuánto tardó realmente el restore, si los datos cuadraron, y
   cualquier sorpresa — apéndice a este mismo archivo o un documento nuevo con fecha en el nombre.

**Nunca se ha ejecutado este drill según la evidencia disponible en el repositorio.** Hasta que se ejecute una vez,
el RPO/RTO de arriba son objetivos, no garantías verificadas — trátalos como tales al comunicarlos a negocio.
