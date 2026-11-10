'use client'

import { useState } from 'react'
import { Archive, CalendarPlus, Loader2, Pencil, Rocket, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/utils'
import { diaEvento, ETIQUETA_ESTADO, type Lanzamiento } from './tipos'

// CALENDARIO Y SUS ACCIONES. Toda acción que cambia algo pasa por un diálogo que dice qué va a pasar
// antes de hacerlo. "Abrir" en particular mueve gente de un lanzamiento a otro y cambia a dónde van
// los leads nuevos: antes era un botón sin confirmación.

export type AccionCalendario =
  | { accion: 'programar'; fecha: string; nombre?: string }
  | { accion: 'abrir'; esperado: string }
  | { accion: 'editar'; id: string; nombre?: string; fecha?: string }
  | { accion: 'cerrar'; id: string }
  | { accion: 'borrar'; id: string }

type Dialogo =
  | { tipo: 'programar' }
  | { tipo: 'abrir' }
  | { tipo: 'editar'; l: Lanzamiento }
  | { tipo: 'cerrar'; l: Lanzamiento }
  | { tipo: 'borrar'; l: Lanzamiento }
  | null

const VARIANTE = { programado: 'secondary', abierto: 'success', cerrado: 'outline' } as const

export function CalendarioLanzamientos({
  calendario,
  activo,
  siguiente,
  visto,
  puedeEditar,
  motivoSoloLectura,
  ejecutando,
  onAccion,
  onVer,
  abrirDialogo,
  onDialogo,
}: {
  calendario: Lanzamiento[]
  activo: Lanzamiento | null
  siguiente: Lanzamiento | null
  visto: Lanzamiento | null
  puedeEditar: boolean
  motivoSoloLectura: string | null
  ejecutando: boolean
  /** Devuelve true si la acción salió bien (para cerrar el diálogo) o false si falló (se queda abierto). */
  onAccion: (a: AccionCalendario) => Promise<boolean>
  onVer: (id: string) => void
  /** El asistente de activación puede pedir que se abra "programar" o "abrir" desde fuera. */
  abrirDialogo: 'programar' | 'abrir' | null
  onDialogo: (d: 'programar' | 'abrir' | null) => void
}) {
  const [local, setLocal] = useState<Dialogo>(null)
  const [fecha, setFecha] = useState('')
  const [nombre, setNombre] = useState('')

  const dialogo: Dialogo = local ?? (abrirDialogo ? { tipo: abrirDialogo } : null)
  const cerrar = () => {
    setLocal(null)
    onDialogo(null)
    setFecha('')
    setNombre('')
  }
  const lanzar = async (a: AccionCalendario) => {
    if (await onAccion(a)) cerrar()
  }
  const editar = (l: Lanzamiento) => {
    setFecha(l.fecha)
    setNombre(l.label)
    setLocal({ tipo: 'editar', l })
  }

  const minFecha = activo ? activo.fecha : undefined

  return (
    <section aria-labelledby="titulo-calendario" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="titulo-calendario" className="font-semibold text-foreground">
            Calendario
          </h2>
          <p className="text-xs text-muted-foreground">
            Programado no recibe leads. Abierto es el que recibe los leads nuevos de GHL. Cerrado queda como histórico.
          </p>
        </div>
        {puedeEditar ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onDialogo('programar')}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> Programar fecha
            </Button>
            <Button
              size="sm"
              disabled={!siguiente}
              title={siguiente ? undefined : 'Programa una fecha primero'}
              onClick={() => onDialogo('abrir')}
            >
              <Rocket className="mr-1.5 h-4 w-4" />
              {siguiente ? `Abrir ${siguiente.label}` : 'Abrir siguiente'}
            </Button>
          </div>
        ) : (
          motivoSoloLectura && <p className="max-w-sm text-xs text-muted-foreground">{motivoSoloLectura}</p>
        )}
      </div>

      {calendario.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Todavía no hay ninguna fecha. {puedeEditar ? 'Empieza por «Programar fecha».' : ''}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {calendario.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{l.label}</span>
                <span className="text-muted-foreground"> · {diaEvento(l.fecha)}</span>
                <Badge variant={VARIANTE[l.estado]} className="ml-2">
                  {activo?.id === l.id ? 'Abierto · recibe leads' : ETIQUETA_ESTADO[l.estado]}
                </Badge>
                {l.estado !== 'programado' && l.abiertoAt && (
                  <span className="block text-xs text-muted-foreground">
                    Abierto el {formatDateTime(l.abiertoAt)}
                    {l.cerradoAt ? ` · cerrado el ${formatDateTime(l.cerradoAt)}` : ''}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {l.estado !== 'programado' && (
                  <Button
                    variant={visto?.id === l.id ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={visto?.id === l.id}
                    onClick={() => onVer(l.id)}
                  >
                    {visto?.id === l.id ? 'Viendo sus datos' : 'Ver datos'}
                  </Button>
                )}
                {puedeEditar && (
                  <>
                    <Button variant="ghost" size="sm" aria-label={`Editar ${l.label}`} onClick={() => editar(l)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {l.estado === 'abierto' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Cerrar ${l.label}`}
                        onClick={() => setLocal({ tipo: 'cerrar', l })}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {l.estado === 'programado' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Borrar ${l.label}`}
                        onClick={() => setLocal({ tipo: 'borrar', l })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Programar / editar ─────────────────────────────────────────── */}
      <Dialog
        open={dialogo?.tipo === 'programar' || dialogo?.tipo === 'editar'}
        onOpenChange={(o) => !o && !ejecutando && cerrar()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogo?.tipo === 'editar' ? 'Editar lanzamiento' : 'Programar un lanzamiento'}</DialogTitle>
            <DialogDescription>
              {dialogo?.tipo === 'editar'
                ? 'El nombre se puede cambiar siempre. La fecha, solo mientras no se haya abierto.'
                : 'Programar solo reserva la fecha. No recibe leads hasta que lo abras.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (dialogo?.tipo === 'editar') {
                void lanzar({
                  accion: 'editar',
                  id: dialogo.l.id,
                  nombre,
                  fecha: dialogo.l.estado === 'programado' ? fecha : undefined,
                })
              } else void lanzar({ accion: 'programar', fecha, nombre: nombre || undefined })
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="lz-fecha">Día del evento</Label>
              <Input
                id="lz-fecha"
                type="date"
                required
                value={fecha}
                min={dialogo?.tipo === 'programar' ? minFecha : undefined}
                disabled={dialogo?.tipo === 'editar' && dialogo.l.estado !== 'programado'}
                onChange={(e) => setFecha(e.target.value)}
              />
              {dialogo?.tipo === 'programar' && activo && (
                <p className="text-xs text-muted-foreground">Tiene que ser posterior a {diaEvento(activo.fecha)}.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lz-nombre">Nombre{dialogo?.tipo === 'programar' ? ' (opcional)' : ''}</Label>
              <Input
                id="lz-nombre"
                value={nombre}
                maxLength={80}
                required={dialogo?.tipo === 'editar'}
                placeholder="Si lo dejas vacío, se usa la fecha"
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar} disabled={ejecutando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={ejecutando || !fecha}>
                {ejecutando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {dialogo?.tipo === 'editar' ? 'Guardar' : 'Programar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Abrir ──────────────────────────────────────────────────────── */}
      <AlertDialog open={dialogo?.tipo === 'abrir'} onOpenChange={(o) => !o && !ejecutando && cerrar()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Abrir {siguiente?.label}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Al abrirlo:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Los leads nuevos que mande GHL se apuntarán a <strong>{siguiente?.label}</strong>
                    {siguiente ? ` (evento del ${diaEvento(siguiente.fecha)})` : ''}.
                  </li>
                  {activo ? (
                    <li>
                      Quien se apuntó a {activo.label} <strong>después</strong> de su evento ({diaEvento(activo.fecha)})
                      se mueve a este, porque llegó cuando aquel ya había pasado.
                    </li>
                  ) : (
                    <li>Es el primero de esta subcuenta: no hay apuntados que mover.</li>
                  )}
                  <li>No se puede deshacer desde aquí. Si te equivocas de fecha, ciérralo y programa otra.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ejecutando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ejecutando || !siguiente}
              onClick={(e) => {
                e.preventDefault()
                if (siguiente) void lanzar({ accion: 'abrir', esperado: siguiente.id })
              }}
            >
              {ejecutando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Abrir lanzamiento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cerrar / borrar ────────────────────────────────────────────── */}
      <AlertDialog
        open={dialogo?.tipo === 'cerrar' || dialogo?.tipo === 'borrar'}
        onOpenChange={(o) => !o && !ejecutando && cerrar()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogo?.tipo === 'cerrar' ? `¿Cerrar ${dialogo.l.label}?` : `¿Borrar ${dialogo?.tipo === 'borrar' ? dialogo.l.label : ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialogo?.tipo === 'cerrar'
                ? 'Pasa a histórico: conserva sus leads, su contenido y su informe, pero deja de recibir leads. Hasta que abras otro, los leads que mande GHL no se apuntarán a ninguno. No se puede reabrir.'
                : 'Se quita la fecha del calendario junto con el contenido y el checklist que hubieras preparado para ella. Como aún no se ha abierto, no tiene leads.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ejecutando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ejecutando}
              className={dialogo?.tipo === 'borrar' ? 'bg-red-600 text-white hover:bg-red-700' : undefined}
              onClick={(e) => {
                e.preventDefault()
                if (dialogo?.tipo === 'cerrar') void lanzar({ accion: 'cerrar', id: dialogo.l.id })
                if (dialogo?.tipo === 'borrar') void lanzar({ accion: 'borrar', id: dialogo.l.id })
              }}
            >
              {ejecutando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {dialogo?.tipo === 'cerrar' ? 'Cerrar lanzamiento' : 'Borrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
