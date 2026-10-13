-- Cotejo de la whitelist de GRANT SELECT de mcp_reader contra el catálogo vivo (10-oct-2026).
-- Corrige la lista de 20261009160000_mcp_server_oauth_and_reader.sql:
--   * 6 tablas listadas ya no existen en producción ('ad_sets', 'affiliate_clicks',
--     'campaign_metrics', 'funnels', 'funnel_steps', 'goals') — el GRANT condicional las
--     ignoraba silenciosamente; se retiran de la lista fuente del repo.
--   * Faltaba 'vsl_embed_locations' (creada en 20261009010000_vsl_tracking_foundation):
--     la única tabla de negocio con RLS que mcp_reader no podía leer, con lo que el
--     ejecutor del servidor MCP fallaría al consultar la ubicación de embeds de un vídeo VSL.
-- Idempotente: GRANT se puede repetir; el EXCEPTION de guarda aborta si alguna tabla de la
-- lista deja de existir, para detectar deriva del catálogo en vez de ignorar en silencio.
DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'tenants','users','contacts','appointments','sales','collections','payment_plans',
    'refunds','commissions','affiliate_campaigns','contract_templates',
    'contracts','campaigns','campaign_targets','contact_attributions',
    'canonical_events','raw_events','event_types','integration_sync_runs',
    'vsl_video_versions','vsl_embed_locations','vsl_playback_sessions','vsl_tracking_events',
    'vsl_watch_intervals','vsl_viewer_identities','stripe_payments','integration_settings'
  ];
  faltantes TEXT := '';
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO mcp_reader', t);
    ELSE
      faltantes := faltantes || t || ' ';
    END IF;
  END LOOP;
  IF faltantes <> '' THEN
    RAISE EXCEPTION 'whitelist con tablas ausentes: %', faltantes;
  END IF;
END $$;
