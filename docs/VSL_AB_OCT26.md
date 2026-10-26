# Campaña A/B VSL — segmento dinámico (26-oct-2026)

Uno el experimento, cómo se evalúa. El código que lo habilita es el PR #646
(`?ab=slugA,slugB` en el embed VSL). Este documento es el plan de la campaña; se archiva al decidir
el ganador.

## Hipótesis y diseño

**Variable única**: el momento del vídeo que aparece como bucle dinámico de la portada
(`previewStartSeconds`, bucle de 6 s en `custom`). Todo lo demás (fuente Bunny, duración, config del
player) es byte-idéntico entre variantes.

| Variante | slug             | Bucle dinámico                                                          | Config                                   |
| -------- | ---------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| A        | `vsl-ab-a-oct26` | segundo **25** (gancho elegido en octubre como el más gancho del vídeo) | copia de `vsl-corta-v1-oct2026`          |
| B        | `vsl-ab-b-oct26` | segundo **0** (gancho de apertura del propio vídeo)                     | idéntica salvo `previewStartSeconds = 0` |

El vídeo base `vsl-corta-v1-oct2026` queda **fuera del experimento**: sus métricas son la línea base
anterior. Las variantes son filas propias de `vsl_videos`, así que el panel VSL ya las mide por
separado sin código adicional.

**Reparto**: 50/50 por carga en el servidor del embed. No es sticky por navegador (un visitante que
vuelve podría ver la otra variante): para comparar agregados a una semana es suficiente y evita
cookies, estado y fragilidad. Con ~20 imp/día la fuerza del test viene del tiempo, no del sticky.

**Duración y criterio**: empieza cuando el snippet nuevo esté puesto en vibepreview y termina
mínimo **7 días**. Mínimo para decidir: **≥100 plays por variante** (con el tráfico actual, la
semana puede quedarse corta: si los plays por variante son < 100 el 2-nov, se amplía la ventana y
se anota aquí). Métricas de decisión, en orden: **play rate** (impresiones → plays), **retención
25/50/95%**, `% medio visto`. El panel de cada variante ya pinta todos los hitos, pero la
comparación se hace con el SQL de abajo para verlas juntas.

## Snippet para vibepreview

Sustituir el iframe actual por (producirá redirección aleatoria de variante por carga):

```html
<iframe
  src="https://app.scalixsystems.com/embed/vsl/vsl-corta-v1-oct2026?tenant=women-digital-closer&ab=vsl-ab-a-oct26,vsl-ab-b-oct26"
  style="width: 100%; height: 640px; border: 0;"
  allow="autoplay; fullscreen; encrypted-media"
  title="VSL"
  allowfullscreen
></iframe>
```

El slug de la URL principal sigue siendo la v1 (por compatibilidad con el tracking de Calendly y
con embeds antiguos), pero con `ab=` siempre sirve A o B. Sin `ab=`, la página sirve la v1 como
siempre (verificado en producción el 26-oct).

## Comparación semanal (automatizada 26-oct)

La comparativa ya NO hace falta lanzarla con SQL a mano: el panel VSL del dashboard la calcula en
cada visita — el bloque desplegable «Comparativa de hitos entre vídeos» (ruta autenticada
`/api/[tenant]/evergreen/vsl/ab-comparativa`, misma definición de hitos que pinta cada vídeo).
Las filas del experimento llevan la etiqueta «experimento» y salen juntas porque los slugs de ambas
variantes empiezan por `vsl-ab-`. El SQL de abajo queda SOLO como referencia si necesitas el
mismo número fuera de la aplicación (p. ej. SQL Editor de Supabase / hilo nuevo) — hitos sobre
`vsl_sessions.max_position`, idéntico al panel:

```sql
WITH var AS (
  SELECT v.slug,
         count(s.id)::int AS impresiones,
         count(s.id) FILTER (WHERE s.max_position > 0)::int AS plays
  FROM vsl_videos v
  LEFT JOIN vsl_sessions s ON s.video_id = v.id AND s.tenant_id = v.tenant_id
  WHERE v.slug IN ('vsl-ab-a-oct26', 'vsl-ab-b-oct26')
  GROUP BY 1
),
hitos AS (
  SELECT v.slug,
         count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.25)::int AS h25,
         count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.50)::int AS h50,
         count(*) FILTER (WHERE s.duration > 0 AND s.max_position >= s.duration * 0.95)::int AS h95,
         round(avg(LEAST(s.max_position / NULLIF(s.duration, 0), 1)) * 100)  AS pct_medio
  FROM vsl_videos v
  JOIN vsl_sessions s ON s.video_id = v.id AND s.tenant_id = v.tenant_id
  WHERE v.slug IN ('vsl-ab-a-oct26', 'vsl-ab-b-oct26') AND s.max_position > 0
  GROUP BY 1
)
SELECT var.slug,
       var.impresiones,
       var.plays,
       round(var.plays * 100.0 / NULLIF(var.impresiones, 0), 1) AS play_rate_pct,
       round(h.h25 * 100.0 / NULLIF(var.plays, 0), 1) AS visto_25_pct,
       round(h.h50 * 100.0 / NULLIF(var.plays, 0), 1) AS visto_50_pct,
       round(h.h95 * 100.0 / NULLIF(var.plays, 0), 1) AS visto_95_pct,
       h.pct_medio
FROM var LEFT JOIN hitos h USING (slug)
ORDER BY slug;
```

## Verificación hecha el 26-oct (producción)

- Deploy `d6ab3e23` Ready; 32 cargas de prueba del embed con `?ab=` sirven ambas variantes con
  reparto vivo (9 A / 15 B en la segunda tanda de 24; ninguna pegada a una sola).
- Control sin `?ab=`: la v1 se sirve intacta para embed sin experimento.
- Estático: `npm run quality` + `npm run build` EXIT=0; CI del PR #646 en verde (incluida la E2E).
- Variante en BD idéntica a la v1 excepto el inicio del bucle (comprobado columna a columna).

**Re-verificación 26-oct tarde:** variantes en BD con la config correcta (A `previewStartSeconds=25`,
B `=0`, ambas `custom`+6 s, mismo tenant) y el embed de producción sigue repartiendo (3 A / 3 B en 6
cargas directas; control 200). Sesiones de las variantes: **0** — el reloj del experimento no
arranca hasta pegar el snippet de arriba en vibepreview (fila 0 de «PENDIENTES DEL DUEÑO»). **26-oct
~17:00Z: el snippet sigue SIN pegarse.** Comprobado en el navegador: ni la página de vibepreview
(referrer real del player) ni la home de womendigitalclosers.com tienen ningún iframe `/embed/vsl/`
hoy (solo Typeform + tracker). Últimas cargas reales del player de la v1: 09:10Z de hoy, una ráfaga
de crawler/ping (mismo segundo, varios devices y países) desde la home — esa mañana el embed
todavía estaba, así que se ha quitado o movido al preparar el snippet. Semilla de la semana 1:
con tráfico orgánico de 0–2 visitas/día, la comparación solo llega al mínimo si se apunta una
fuente (anuncio o email) a la página donde quede el snippet; si no, ampliar ventana el 2-nov.

## Riesgos a vigilar

1. **Muestra**: con 0–2 plays/día recientes, la semana 1 puede no llegar al mínimo. Decidir el
   2-nov si se amplía.
2. **Mezcla de tráfico**: si vibepreview cambia la página entre medias (o se añade otro embed de la
   v1 SIN `ab=`), el play rate de A y B se contamina con tráfico distinto. La v1 pura NO cuenta
   como variante.
3. El heatmap del experimento usa la capa canónica: los paneles de las variantes arrancan en modo
   `legacy` hasta el primer play con intervalos.
