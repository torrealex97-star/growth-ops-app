'use client'

import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type ExternalThumbnailProps = {
  src: string | null | undefined
  alt?: string
  className?: string
  showLabel?: boolean
}

export function ExternalThumbnail({ src, alt = '', className, showLabel = false }: ExternalThumbnailProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
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
    // eslint-disable-next-line @next/next/no-img-element -- URLs externas efímeras: no se proxyfican para evitar coste y cachear recursos caducados.
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
