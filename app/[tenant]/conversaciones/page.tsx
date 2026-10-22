'use client'

import { type ComponentType } from 'react'
import { Bot, GraduationCap, Inbox, LineChart, MessageCircle } from 'lucide-react'
import { useParamUrl } from '@/lib/hooks/useParamUrl'
import { useSesion } from '@/lib/tenant-context'
import { ROLES_IA } from '@/lib/conversaciones/acciones'
import BandejaTab from './BandejaTab'
import PlataformasTab from './PlataformasTab'
import AgenteTab from './AgenteTab'
import EntrenamientoTab from './EntrenamientoTab'
import MetricasTab from './MetricasTab'

// UNA SOLA PANTALLA para todo lo de conversaciones (antes repartido entre /conversaciones y /setting-ai):
//   · Bandeja       → conversaciones guardadas (webhook de GHL) con estados, asignación y borradores de la IA.
//   · Plataformas   → lectura en directo de Instagram / GHL / Facebook / TikTok, con análisis de cada hilo.
//   · Agente de IA  → guion, topes, horario y reparto (solo administración).
//   · Entrenamiento → simulador, crítico y mejora del prompt del setter de IA.
//   · Métricas      → cómo se atienden los mensajes (equipo vs IA).
// La pestaña vive en la URL (?tab=): se puede compartir el enlace y las rutas antiguas redirigen aquí.

const PESTANAS = ['bandeja', 'plataformas', 'agente', 'entrenamiento', 'metricas'] as const
type Pestana = (typeof PESTANAS)[number]

const DEFINICION: Record<
  Pestana,
  { etiqueta: string; icono: ComponentType<{ className?: string }>; Vista: ComponentType }
> = {
  bandeja: { etiqueta: 'Bandeja', icono: Inbox, Vista: BandejaTab },
  plataformas: { etiqueta: 'Plataformas', icono: MessageCircle, Vista: PlataformasTab },
  agente: { etiqueta: 'Agente de IA', icono: Bot, Vista: AgenteTab },
  entrenamiento: { etiqueta: 'Entrenamiento', icono: GraduationCap, Vista: EntrenamientoTab },
  metricas: { etiqueta: 'Métricas', icono: LineChart, Vista: MetricasTab },
}

export default function ConversacionesPage() {
  const sesion = useSesion()
  const [tab, setTab] = useParamUrl<Pestana>('tab', 'bandeja', PESTANAS)
  const puedeIA = !!sesion && (sesion.isSuperAdmin || (ROLES_IA as readonly string[]).includes(sesion.rol ?? ''))
  // La configuración del agente decide si una IA habla en nombre del negocio: solo administración.
  const visibles = PESTANAS.filter((t) => t !== 'agente' || puedeIA)
  const activa: Pestana = visibles.includes(tab) ? tab : 'bandeja'
  const { Vista } = DEFINICION[activa]

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Conversaciones</h1>
        <p className="text-sm text-muted-foreground">
          Los mensajes de tus leads en todas las plataformas, el agente de IA de setting y su entrenamiento, en un solo
          sitio.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Secciones de conversaciones">
        {visibles.map((t) => {
          const { etiqueta, icono: Icono } = DEFINICION[t]
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activa === t}
              onClick={() => setTab(t)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                activa === t
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icono className="h-3.5 w-3.5" aria-hidden /> {etiqueta}
            </button>
          )
        })}
      </div>
      <Vista />
    </div>
  )
}
