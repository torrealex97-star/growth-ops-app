import Link from 'next/link'
import { Compass, House } from 'lucide-react'

// 404 global. Antes cualquier ruta inexistente caía en el not-found por defecto de Next
// (en inglés y sin contexto), y la confusión típica era escribir mal el slug de subcuenta.
// Aquí se separan los dos casos que le pueden pasar a un usuario real: la pantalla no existe,
// o la subcuenta no existe — en ambos casos la salida es el selector de subcuenta de la home.
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card/50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/10">
          <Compass className="h-6 w-6 text-brand-600" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Esta página no existe</h1>
        <p className="text-sm text-muted-foreground">
          No se ha encontrado la ruta que has abierto. Si intentabas entrar en una subcuenta, revisa el identificador:
          la dirección es <code className="rounded bg-muted px-1 py-0.5 text-xs">/nombre-subcuenta</code>.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <House className="h-4 w-4" aria-hidden="true" /> Volver al selector de subcuenta
        </Link>
      </div>
    </div>
  )
}
