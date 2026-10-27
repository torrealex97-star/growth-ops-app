-- SNAPSHOT MANUAL de pg_stat_statements: línea base para comparaciones antes/después.
--
-- Por qué existe: al cerrar el 27-oct el bucle de medición del InitPlan RLS (#635) no hubo
-- comparación pre/post posible — pg_stat_statements acumula desde el reset (10-sep-2026) y no
-- guarda el estado previo a un cambio. Con este par de tablas, cualquier cambio de rendimiento
-- se ancla ANTES de aplicarlo:
--
--   1. `SELECT public.pgss_take_snapshot('motivo'::text);` — ANTES del cambio (baseline).
--   2. Se aplica el cambio (migración, índice, rediseño...).
--   3. Se espera el intervalo de medida (idealmente 24 h+; para curvas de carga pequeñas,
--      horas tienen señal si el flujo es constante).
--   4. Otro snapshot con el mismo motivo notado y el delta es una join SQL trivial entre ambos
--      (protocolo completo en docs/FREE_TIER_OPERATIONS.md, sección «Snapshots pg_stat»).
--
-- Manual y no cron a propósito: no hay tarea programada que avalar en Vercel/Supabase free
-- (presupuesto permanente de `docs/FREE_TIER_OPERATIONS.md`), y el valor del snapshot es
-- anclar decisiones concretas — un snapshot sin evento asociado no se puede comparar contra nada.
--
-- WHO can take/see: solo vía SQL (postgres/servicio): REVOKE para anon/authenticated/PUBLIC y
-- RLS sin políticas — la plataforma no piensa tocar estas filas por la API de datos. Espejo del
-- patrón de `platform_settings` (20261014120000).
--
-- Tamaño: ~4.945 statements en esta BD (~0,7 MB por snapshot). No hay retención automática:
-- borrar snapshots sería reparar el registro de una decisión ya tomada; antes de borrar ninguno,
-- revisar la política de retención con el dueño cuando el volumen lo pida.

CREATE TABLE IF NOT EXISTS public.pgss_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at    timestamptz NOT NULL DEFAULT now(),
  stats_reset_at timestamptz NOT NULL,
  note           text,
  created_by     text NOT NULL DEFAULT 'freebuff'
);

CREATE TABLE IF NOT EXISTS public.pgss_snapshot_statements (
  snapshot_id uuid NOT NULL REFERENCES public.pgss_snapshots (id) ON DELETE CASCADE,
  queryid     bigint NOT NULL,
  query_left  text NOT NULL, -- recorte de 160 chars para reconocer la shape; la identidad es queryid
  calls       bigint NOT NULL,
  total_ms    numeric(14, 1) NOT NULL,
  rows_count  bigint NOT NULL,
  mean_ms     numeric(12, 2) NOT NULL,
  PRIMARY KEY (snapshot_id, queryid)
);

ALTER TABLE public.pgss_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pgss_snapshot_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pgss_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pgss_snapshot_statements FROM PUBLIC, anon, authenticated;

-- Toma un snapshot completo de pg_stat_statements y devuelve su id.
-- SECURITY DEFINER: postgres lo ejecuta; nadie más tiene EXECUTE (REVOKE de PUBLIC abajo).
CREATE OR REPLACE FUNCTION public.pgss_take_snapshot(p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_reset   timestamptz;
  v_filas   bigint;
BEGIN
  -- Un hueco no es un dato: si por algún motivo no hay ventana de reset declarada
  -- (extensión recién reinstalada), el snapshot se rechaza antes de insertar.
  -- Nombres CUALIFICADOS a propósito: las vistas de la extensión viven en `extensions`
  -- y search_path=pg_catalog, public no las alcanzaría (lo cazó el dry-run del 27-oct).
  SELECT s.stats_reset INTO v_reset FROM extensions.pg_stat_statements_info s;
  IF v_reset IS NULL THEN
    RAISE EXCEPTION 'pg_stat_statements no declara stats_reset: sin ventana de comparación';
  END IF;

  INSERT INTO public.pgss_snapshots (stats_reset_at, note) VALUES (v_reset, p_note)
  RETURNING id INTO v_id;

  INSERT INTO public.pgss_snapshot_statements
      (snapshot_id, queryid, query_left, calls, total_ms, rows_count, mean_ms)
  SELECT v_id,
         q.queryid,
         left(q.query, 160),
         q.calls,
         round(q.total_exec_time::numeric, 1),
         q.rows,
         round(q.mean_exec_time::numeric, 2)
  FROM extensions.pg_stat_statements q
  ON CONFLICT (snapshot_id, queryid) DO NOTHING;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'snapshot % vacío: pg_stat_statements devolvió 0 statements', v_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.pgss_take_snapshot(text) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.pgss_snapshots IS
  'Snapshot manual de pg_stat_statements: un punto en el tiempo de la ventana de stats (global de' ||
  ' plataforma, no por subcuenta). Solo SQL (postgres/servicio); RLS sin políticas.';
COMMENT ON TABLE public.pgss_snapshot_statements IS
  'Una fila por statement de pg_stat_statements en el snapshot (queryid). Delta = join entre dos snapshots.';
COMMENT ON FUNCTION public.pgss_take_snapshot(text) IS
  'Toma un snapshot de pg_stat_statements. Ancla la ventana de un cambio de rendimiento; ver protocolo en docs/FREE_TIER_OPERATIONS.md.';
