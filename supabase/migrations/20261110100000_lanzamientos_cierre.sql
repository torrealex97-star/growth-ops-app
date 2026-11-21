-- Lanzamientos — cierre explícito (10-nov-2026). Idempotente.
--
-- Hasta ahora un lanzamiento solo tenía dos estados: programado (opened_at NULL) y abierto. "Activo"
-- era el último abierto para siempre: seguía recibiendo los leads del webhook aunque su evento
-- hubiera pasado hacía semanas, y no había forma de pasarlo a histórico sin abrir otro.
--
--   · `closed_at`  — NULL = sigue abierto. Con valor = histórico: conserva leads, contenido e informe,
--     pero ya no es el activo. No se reabre: un lanzamiento nuevo es una fecha nueva.
--   · `closed_by`  — quién lo cerró (auditoría), como `opened_by`.
--
-- El código tolera que esta migración aún no esté aplicada (lee sin la columna y nadie está
-- cerrado); solo la acción "Cerrar" la exige y lo dice con un mensaje claro.

ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Un lanzamiento no puede cerrarse sin haberse abierto, ni cerrarse antes de abrirse.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'launches_cierre_coherente' AND conrelid = 'public.launches'::regclass
  ) THEN
    ALTER TABLE public.launches
      ADD CONSTRAINT launches_cierre_coherente
      CHECK (closed_at IS NULL OR (opened_at IS NOT NULL AND closed_at >= opened_at));
  END IF;
END $$;

-- Sin índice nuevo: el calendario de una subcuenta son decenas de filas y ya se lee por
-- launches_tenant_fecha_key (tenant_id, fecha).
