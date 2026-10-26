-- El servidor MCP (rol `mcp_reader`) podrá LISTAR conversaciones (no sus mensajes ni sus eventos).
--
-- Solo SELECT sobre `public.conversations`: estado, canal, modo de IA, etiquetas, contacto y responsable. Los mensajes
-- (`conversation_messages`) y los eventos (`conversation_events`) llevan texto personal de los leads y NO se conceden.
-- El aislamiento sigue siendo el RLS del usuario que autorizó la conexión: la política `conversations_select_roles`
-- limita la lectura a los roles de ventas/marketing, y la restrictiva de tenant al resto de subcuentas.
-- Idempotente (GRANT repetible). Aborta si la tabla no existe en vez de ignorarlo en silencio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations') THEN
    RAISE EXCEPTION 'public.conversations no existe: aplica antes 20261022100000_conversaciones.sql';
  END IF;
  GRANT SELECT ON TABLE public.conversations TO mcp_reader;
END $$;
