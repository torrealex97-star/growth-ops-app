-- public_tenant_branding: proyección whitelist del único dato público de tenants.
--
-- Antes la RPC devolvía `settings -> 'branding'` entero. Cualquier clave que terminara escrita en
-- `settings.branding` viajaba publicada a anon (el escritor de la UI hace `{ ...currentBranding }`
-- y las migraciones antiguas añadían claves a mano): un objeto pensado como { name, accent,
-- logo_url } era un canal abierto de `settings` a todo el mundo.
--
-- La RL de la casa: lo público es solo lo que el login pinta — nombre de marca, acento y logo.
-- La proyección es EXPLÍCITA con esas tres claves; lo demás de `settings.branding` no sale.
--
-- Semántica preservada (verificada como anon con aserciones antes y después del apply):
--   - slug desconocido o tenant no activo ⇒ 0 filas (el cliente distingue `missing` de error);
--   - tenant activo sin branding propio ⇒ 1 fila con branding NULL (no se confunde con missing);
--   - tenant activo con branding ⇒ un solo objeto con name/accent/logo_url (logo_url NULL si falta).
CREATE OR REPLACE FUNCTION public.public_tenant_branding(p_slug text)
RETURNS TABLE (branding jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN b IS NULL THEN NULL::jsonb
    ELSE jsonb_build_object(
      'name',     b ->> 'name',
      'accent',   b ->> 'accent',
      'logo_url', b ->> 'logo_url'
    )
  END
  FROM public.tenants t
  CROSS JOIN LATERAL (SELECT t.settings -> 'branding' AS b) s
  WHERE t.slug = p_slug
    AND t.status = 'active'
$$;

-- El ACL existente (anon, authenticated) se conserva por el CREATE OR REPLACE; se reitera para
-- que la migración sea reproducible en una BD donde la función no tenga la ACL puesta.
GRANT EXECUTE ON FUNCTION public.public_tenant_branding(text) TO anon, authenticated;
