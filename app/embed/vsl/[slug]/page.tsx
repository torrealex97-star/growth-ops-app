import { mergeConfig } from '@/lib/vsl/db'
import { resolvePublicVsl } from '@/lib/vsl/public-video'
import { elegirVarianteAb, parseAbPair } from '@/lib/vsl/ab'
import { VslPlayer } from '@/components/vsl/VslPlayer'

export const dynamic = 'force-dynamic'

// Origen (protocolo + host) de una URL, para poder abrir la conexión (preconnect) cuanto antes.
function originOf(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

export default async function VslEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tenant?: string; ab?: string }>
}) {
  const { slug } = await params
  const { tenant, ab } = await searchParams
  let resolution = await resolvePublicVsl(slug, tenant)

  // Experimento A/B opcional: `?ab=slugA,slugB` reparte las CARGAS 50/50 entre dos vídeos de
  // vsl_videos de la MISMA subcuenta (misma fuente, distinto segmento dinámico). Cada variante
  // es su propia fila: las métricas del panel quedan separadas y comparables de casa.
  // Degradación: si el par no parsea, una variante no existe o caen en OTRA subcuenta, el
  // embed sigue sirviendo el vídeo pedido — un experimento no rompe jamás un embed vivo.
  // La moneda es por carga (no sticky por navegador): para comparar agregados a una semana
  // es suficiente y no añade cookies ni estado propio. La página es force-dynamic, así que
  // cada render tira de nuevo.
  if (ab) {
    const par = parseAbPair(ab)
    if (par) {
      try {
        const [resA, resB] = await Promise.all([
          resolvePublicVsl(par.varianteA, tenant),
          resolvePublicVsl(par.varianteB, tenant),
        ])
        const moneda = elegirVarianteAb(par, Math.random())
        const candidata = moneda === par.varianteA ? resA : resB
        const mismaCuenta =
          resolution.status === 'found' &&
          candidata.status === 'found' &&
          candidata.video.tenant_slug === resolution.video.tenant_slug
        if (mismaCuenta) resolution = candidata
      } catch (e) {
        console.error('[vsl/ab] variante no resolvió, degradando al vídeo pedido', e)
      }
    }
  }

  if (resolution.status !== 'found') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-sm text-white/50">
        {resolution.status === 'ambiguous'
          ? 'Este código de inserción es antiguo. Genera uno nuevo desde la subcuenta.'
          : 'Vídeo no encontrado.'}
      </div>
    )
  }
  const { video } = resolution

  const mediaOrigins = Array.from(
    new Set([originOf(video.source_url), originOf(video.poster_url)].filter(Boolean) as string[])
  )

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      {/* Abrir la conexión al CDN del vídeo antes de que arranque el player (ahorra el handshake).
          Sin crossOrigin: el <video>/preload van en modo no-cors y así se reutiliza la conexión. */}
      {mediaOrigins.map((o) => (
        <link key={o} rel="preconnect" href={o} />
      ))}
      {/* El póster se muestra al instante (sin negro). */}
      {video.poster_url && <link rel="preload" as="image" href={video.poster_url} />}
      {/* Empezar a descargar el vídeo cuanto antes, en paralelo con la carga del JS. */}
      {video.source_url && <link rel="preload" as="video" href={video.source_url} />}
      <VslPlayer
        embed
        video={{
          tenant: video.tenant_slug,
          slug: video.slug,
          source_url: video.source_url,
          poster_url: video.poster_url,
          duration_seconds: Number(video.duration_seconds) || 0,
          config: mergeConfig(video.config),
        }}
      />
    </div>
  )
}
