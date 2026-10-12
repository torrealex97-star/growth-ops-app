'use client'

import { useEffect, useMemo, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { instagramThumbnailResolverFromPermalink } from '@/lib/social/thumbnail'

type ExternalThumbnailProps = {
  src: string | null | undefined
  permalink?: string | null
  alt?: string
  className?: string
  showLabel?: boolean
}

export function ExternalThumbnail({ src, permalink, alt = '', className, showLabel = false }: ExternalThumbnailProps) {
  const sources = useMemo(
    () =>
      Array.from(
        new Set([src, instagramThumbnailResolverFromPermalink(permalink)].filter((value): value is string => !!value))
      ),
    [permalink, src]
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => setAttempt(0), [permalink, src])

  const currentSrc = sources[attempt]

  if (!currentSrc) {
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt ? `${alt} no disponible` : undefined}
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground',
          className
        )}
      >
        <ImageOff className={showLabel ? 'h-8 w-8' : 'h-5 w-5'} aria-hidden="true" />
        {showLabel && <span className="text-xs">Miniatura no disponible</span>}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- La URL primaria es externa; el fallback solo resuelve un redirect y no proxyfica bytes.
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setAttempt((current) => (current === attempt ? current + 1 : current))}
    />
  )
}
