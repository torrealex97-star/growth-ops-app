-- Una exclusión manual de colaborador es una decisión financiera, no un hueco
-- pendiente de rellenar. Sin este estado, el siguiente webhook/backfill podía
-- reconstruir la relación desde el código UTM y volver a crear comisiones.
ALTER TABLE public.contact_attributions
  ADD COLUMN IF NOT EXISTS collaborator_attribution_blocked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contact_attributions.collaborator_attribution_blocked IS
  'TRUE cuando un admin retiró expresamente el colaborador; webhooks, syncs y backfills no pueden reatribuirlo hasta un nuevo override administrativo.';

-- Defensa en profundidad: también protege frente a una versión antigua de la
-- aplicación que intente escribir collaborator_id sin leer el bloqueo. Un
-- override administrativo nuevo puede asignar si levanta el bloqueo en la
-- misma operación.
CREATE OR REPLACE FUNCTION public.enforce_collaborator_attribution_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF OLD.collaborator_attribution_blocked
     AND NEW.collaborator_attribution_blocked
     AND OLD.collaborator_id IS NULL
     AND NEW.collaborator_id IS NOT NULL THEN
    NEW.collaborator_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS contact_attributions_enforce_collaborator_block
  ON public.contact_attributions;
CREATE TRIGGER contact_attributions_enforce_collaborator_block
BEFORE UPDATE OF collaborator_id, collaborator_attribution_blocked
ON public.contact_attributions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_collaborator_attribution_block();

CREATE OR REPLACE FUNCTION public.attribute_ghl_contacts_for_collaborator(
  p_tenant_id uuid,
  p_profile_id uuid,
  p_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_cutoff timestamptz := TIMESTAMPTZ '2026-08-01 00:00:00+00';
  v_updated integer := 0;
  fila record;
BEGIN
  IF v_code = '' OR p_profile_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR fila IN
    SELECT ca.id, ca.contact_id
    FROM public.contact_attributions ca
    JOIN public.contacts c ON c.id = ca.contact_id
    WHERE ca.tenant_id = p_tenant_id
      AND ca.collaborator_id IS NULL
      AND NOT ca.collaborator_attribution_blocked
      AND upper(btrim(coalesce(ca.utm_content, ''))) = v_code
      AND coalesce(c.first_seen_at, c.created_at) >= v_cutoff
      AND EXISTS (
        SELECT 1
        FROM public.appointments ap
        WHERE ap.contact_id = ca.contact_id
          AND ap.tenant_id = ca.tenant_id
          AND ap.status <> 'cancelled'
      )
    FOR UPDATE
  LOOP
    UPDATE public.contact_attributions
    SET collaborator_id = p_profile_id,
        updated_at = now()
    WHERE id = fila.id
      AND collaborator_id IS NULL
      AND NOT collaborator_attribution_blocked;

    IF FOUND THEN
      v_updated := v_updated + 1;
      INSERT INTO public.audit_logs (tenant_id, entity_type, entity_id, action, old_values, new_values)
      VALUES (
        p_tenant_id,
        'contact_attribution',
        fila.contact_id,
        'collaborator_attribution',
        jsonb_build_object('collaborator_id', NULL),
        jsonb_build_object(
          'collaborator_id', p_profile_id,
          'via', 'ghl_backfill_trigger',
          'code', v_code,
          'regla', 'solo_agendaron',
          'manual_block_checked', true
        )
      );
    END IF;
  END LOOP;

  RETURN v_updated;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.attribute_ghl_contacts_for_collaborator(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attribute_ghl_contacts_for_collaborator(uuid, uuid, text)
  TO service_role;
