// Cliente de la YouTube Data API v3 para consultar el canal y, con consentimiento separado,
// espejar reels propios de Instagram como Shorts. El cliente OAuth es global; solo el refresh token
// cifrado identifica la cuenta autorizada de cada subcuenta.
import { google } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Readable } from 'stream'
import { googleCredentials, googleRedirectUri } from '@/lib/google/oauth'
import { decryptSecret } from '@/lib/config'
import { getValidGoogleAccessToken } from '@/lib/google/token-store'

/**
 * Credenciales efectivas de UNA subcuenta. El client id/secret siempre pertenece a la plataforma;
 * el refresh token sale exclusivamente de la fila tenant-scoped.
 */
export type YoutubeEnv = {
  YOUTUBE_CLIENT_ID?: string
  YOUTUBE_CLIENT_SECRET?: string
  YOUTUBE_REFRESH_TOKEN?: string
  YOUTUBE_ACCESS_TOKEN?: string
}

export function isYoutubeConfigured(env: YoutubeEnv): boolean {
  return !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN)
}

export async function loadYoutubeEnv(
  sb: SupabaseClient,
  tenantId: string,
  provider: 'youtube' | 'youtube_publish' = 'youtube_publish'
): Promise<YoutubeEnv> {
  const credentials = await googleCredentials()
  if (!credentials) return {}
  const { data, error } = await sb
    .from('google_oauth_connections')
    .select('id,refresh_token,access_token,access_token_expires_at,status')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle()
  if (error || !data || data.status !== 'conectada') return {}
  try {
    const access = await getValidGoogleAccessToken(sb, data)
    if ('error' in access) return {}
    return {
      YOUTUBE_CLIENT_ID: credentials.clientId,
      YOUTUBE_CLIENT_SECRET: credentials.clientSecret,
      YOUTUBE_REFRESH_TOKEN: decryptSecret(data.refresh_token),
      YOUTUBE_ACCESS_TOKEN: access.token,
    }
  } catch {
    return {}
  }
}

function getAuthClient(env: YoutubeEnv) {
  const oauth2Client = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, googleRedirectUri())
  oauth2Client.setCredentials({
    refresh_token: env.YOUTUBE_REFRESH_TOKEN,
    access_token: env.YOUTUBE_ACCESS_TOKEN,
  })
  return oauth2Client
}

export type YoutubeUploadResult = { videoId: string; url: string }

// Descarga el vídeo (media_url de Instagram, con expiración) y lo sube a YouTube como Short.
export async function uploadReelToYoutube(
  videoUrl: string,
  title: string,
  description: string,
  env: YoutubeEnv
): Promise<YoutubeUploadResult> {
  if (!isYoutubeConfigured(env))
    throw new Error('Faltan credenciales de YouTube (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)')

  // Timeout: es una descarga de vídeo, así que es holgado — pero sin ninguno, un CDN colgado
  // bloquea la subida y el backfill se queda a medias sin decir por qué.
  const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(45_000) })
  if (!videoRes.ok || !videoRes.body) throw new Error(`No se pudo descargar el vídeo de Instagram (${videoRes.status})`)
  const buffer = Buffer.from(await videoRes.arrayBuffer())

  const youtube = google.youtube({ version: 'v3', auth: getAuthClient(env) })
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description: `${description}\n\n#Shorts`.slice(0, 4900),
        categoryId: '22', // People & Blogs
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    },
    media: { body: Readable.from(buffer) },
  })

  const videoId = res.data.id
  if (!videoId) throw new Error('YouTube no devolvió el id del vídeo subido')
  return { videoId, url: `https://youtube.com/shorts/${videoId}` }
}

export type YoutubeVideoStats = { videoId: string; views: number; likes: number; comments: number }

// Estadísticas actuales de vídeos ya subidos, para reflejarlas en la app junto a las de Instagram.
// La API acepta hasta 50 ids por llamada.
export async function fetchVideoStats(videoIds: string[], env: YoutubeEnv): Promise<YoutubeVideoStats[]> {
  if (!isYoutubeConfigured(env) || videoIds.length === 0) return []
  const youtube = google.youtube({ version: 'v3', auth: getAuthClient(env) })
  const out: YoutubeVideoStats[] = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const res = await youtube.videos.list({ part: ['statistics'], id: batch })
    for (const item of res.data.items ?? []) {
      if (!item.id) continue
      out.push({
        videoId: item.id,
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
      })
    }
  }
  return out
}
