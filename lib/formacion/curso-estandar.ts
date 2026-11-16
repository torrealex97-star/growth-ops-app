/**
 * Curso estándar de colaboradoras. Se siembra por subcuenta con un botón («Crear curso estándar»); NO trae
 * vídeos: cada admin añade los suyos (YouTube, Loom, Wistia, Vimeo o Bunny). Los pasos describen lo que la
 * colaboradora hace de verdad en su panel, para que el vídeo de cada lección sea «muéstrame esto en pantalla».
 */

export interface LeccionPlantilla {
  title: string
  description: string
}

export interface CursoPlantilla {
  title: string
  description: string
  lecciones: readonly LeccionPlantilla[]
}

export const CURSO_ESTANDAR: CursoPlantilla = {
  title: 'Primeros pasos como colaboradora',
  description: 'Todo lo que necesitas para empezar: tu panel, tu enlace, tus comisiones y tu factura.',
  lecciones: [
    {
      title: 'Bienvenida y cómo funciona tu panel',
      description:
        'Recorrido por tu dashboard: el selector de mes, tus comisiones, tu embudo y qué significa cada bloque.',
    },
    {
      title: 'Tu código y tu enlace de referido',
      description:
        'Dónde encontrar tu código, cómo compartir tu enlace y por qué todo lo que traigas con él queda atribuido a ti.',
    },
    {
      title: 'Cómo seguir a tus contactos y agendas',
      description: 'Cómo ver a quién has traído, qué agendas tienen y en qué punto del proceso está cada persona.',
    },
    {
      title: 'Tus comisiones del mes',
      description: 'Cómo leer el resumen mensual: comisión por venta nueva, recurrencia, previsión y cuándo se cobra.',
    },
    {
      title: 'Cómo subir tu factura',
      description: 'Paso a paso: cuándo toca facturar, qué datos debe llevar y cómo subirla desde tu panel.',
    },
    {
      title: 'Clientes con pagos pendientes',
      description: 'Qué significa que un cliente tenga un pago pendiente, cómo afecta a tu comisión y qué hacer.',
    },
  ],
}
