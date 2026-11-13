import assert from 'node:assert/strict'
import test from 'node:test'
import {
  abrirSiguienteLanzamiento,
  borrarProgramado,
  calendario,
  cerrarLanzamiento,
  editarLanzamiento,
  lanzamientoActivo,
  programarLanzamiento,
  siguienteLanzamiento,
} from '../lib/launch/lanzamientos.ts'
import { sbMemoria } from './fixtures/sb-memoria.mjs'

const T = 'tenant-a'
const OTRO = 'tenant-b'
const unicos = {
  launches: [
    ['tenant_id', 'slug'],
    ['tenant_id', 'fecha'],
  ],
}
const fila = (o) => ({ tenant_id: T, opened_at: null, closed_at: null, ...o })

test('el PRIMER lanzamiento de una subcuenta se puede abrir (no hay anterior ni apuntados que mover)', async () => {
  const { sb, datos } = sbMemoria({
    launches: [fila({ id: 'l1', slug: 'lanzamiento-1', label: 'Uno', fecha: '2026-12-01' })],
    contact_launches: [],
  })
  assert.equal((await siguienteLanzamiento(sb, T))?.id, 'l1', 'sin activo, el siguiente es el programado')
  const r = await abrirSiguienteLanzamiento(sb, T, 'u1', 'l1')
  assert.equal(r.anterior, null)
  assert.equal(r.nuevo.id, 'l1')
  assert.equal(r.movidos, 0)
  assert.ok(datos.launches[0].opened_at, 'queda abierto')
  assert.equal((await lanzamientoActivo(sb, T))?.id, 'l1')
})

test('abrir es un claim atómico: el segundo clic no abre otro ni duplica', async () => {
  const { sb } = sbMemoria({
    launches: [fila({ id: 'l1', slug: 's1', label: 'Uno', fecha: '2026-12-01' })],
    contact_launches: [],
  })
  await abrirSiguienteLanzamiento(sb, T, 'u1', 'l1')
  await assert.rejects(() => abrirSiguienteLanzamiento(sb, T, 'u1', 'l1'), /No quedan lanzamientos programados/)
})

test('sin fechas programadas se dice tal cual, sin inventar un lanzamiento', async () => {
  const { sb } = sbMemoria({ launches: [], contact_launches: [] })
  await assert.rejects(() => abrirSiguienteLanzamiento(sb, T, 'u1'), /No quedan lanzamientos programados/)
  assert.equal(await lanzamientoActivo(sb, T), null)
})

test('abrir el siguiente mueve solo a los apuntados DESPUÉS del evento anterior y solo de esta subcuenta', async () => {
  const { sb, datos } = sbMemoria({
    launches: [
      fila({ id: 'l1', slug: 's1', label: 'Uno', fecha: '2026-10-01', opened_at: '2026-09-01T10:00:00Z' }),
      fila({ id: 'l2', slug: 's2', label: 'Dos', fecha: '2026-11-01' }),
      { id: 'x1', tenant_id: OTRO, slug: 's1', label: 'Ajeno', fecha: '2026-11-15', opened_at: null, closed_at: null },
    ],
    contact_launches: [
      { id: 'a', tenant_id: T, launch_id: 'l1', contact_id: 'c1', created_at: '2026-09-20T10:00:00Z' },
      { id: 'b', tenant_id: T, launch_id: 'l1', contact_id: 'c2', created_at: '2026-10-05T10:00:00Z' },
      { id: 'z', tenant_id: OTRO, launch_id: 'l1', contact_id: 'c9', created_at: '2026-10-06T10:00:00Z' },
    ],
  })
  const r = await abrirSiguienteLanzamiento(sb, T, 'u1', 'l2')
  assert.equal(r.anterior?.id, 'l1')
  assert.equal(r.movidos, 1)
  const porId = Object.fromEntries(datos.contact_launches.map((c) => [c.id, c.launch_id]))
  assert.deepEqual(porId, { a: 'l1', b: 'l2', z: 'l1' }, 'la fila de otra subcuenta no se toca')
  assert.equal(datos.launches.find((l) => l.id === 'x1').opened_at, null, 'no abre el de otra subcuenta')
})

test('programar: nombre opcional, fecha válida y posterior al activo, sin duplicar fecha', async () => {
  const { sb } = sbMemoria({ launches: [], contact_launches: [] }, { unicos })
  const a = await programarLanzamiento(sb, T, '2026-12-01', '  Black Friday  ')
  assert.equal(a.label, 'Black Friday')
  assert.equal(a.estado, 'programado')
  const b = await programarLanzamiento(sb, T, '2026-12-15')
  assert.match(b.label, /Lanzamiento 15 Dic 2026/)
  await assert.rejects(() => programarLanzamiento(sb, T, '2026-12-01'), /ya está en el calendario/)
  await assert.rejects(() => programarLanzamiento(sb, T, '31/12/2026'), /Fecha no válida/)
  await abrirSiguienteLanzamiento(sb, T, null)
  await assert.rejects(() => programarLanzamiento(sb, T, '2026-11-01'), /posterior al lanzamiento activo/)
})

test('editar: el nombre siempre; la fecha solo mientras está programado', async () => {
  const { sb } = sbMemoria(
    {
      launches: [
        fila({ id: 'l1', slug: 's1', label: 'Uno', fecha: '2026-10-01', opened_at: '2026-09-01T10:00:00Z' }),
        fila({ id: 'l2', slug: 's2', label: 'Dos', fecha: '2026-11-01' }),
      ],
    },
    { unicos }
  )
  assert.equal((await editarLanzamiento(sb, T, 'l1', { label: 'Renombrado' })).label, 'Renombrado')
  await assert.rejects(() => editarLanzamiento(sb, T, 'l1', { fecha: '2026-10-02' }), /ya está abierto/)
  assert.equal((await editarLanzamiento(sb, T, 'l2', { fecha: '2026-11-20' })).fecha, '2026-11-20')
  await assert.rejects(() => editarLanzamiento(sb, T, 'l2', { fecha: '2026-09-01' }), /posterior/)
  await assert.rejects(() => editarLanzamiento(sb, OTRO, 'l2', { label: 'x' }), /no encontrado/)
  await assert.rejects(() => editarLanzamiento(sb, T, 'l2', { label: '   ' }), /nombre/)
})

test('cerrar: deja de ser el activo y el webhook ya no tiene dónde apuntar; reabrir no existe', async () => {
  const { sb } = sbMemoria({
    launches: [
      fila({ id: 'l1', slug: 's1', label: 'Uno', fecha: '2026-10-01', opened_at: '2026-09-01T10:00:00Z' }),
      fila({ id: 'l2', slug: 's2', label: 'Dos', fecha: '2026-11-01' }),
    ],
    contact_launches: [],
  })
  await assert.rejects(() => cerrarLanzamiento(sb, T, 'l2'), /no está abierto/)
  await assert.rejects(() => cerrarLanzamiento(sb, OTRO, 'l1'), /no está abierto/)
  const c = await cerrarLanzamiento(sb, T, 'l1')
  assert.equal(c.estado, 'cerrado')
  assert.equal(await lanzamientoActivo(sb, T), null)
  const cal = await calendario(sb, T)
  assert.deepEqual(
    cal.map((l) => [l.id, l.estado]),
    [
      ['l2', 'programado'],
      ['l1', 'cerrado'],
    ]
  )
  // Con el anterior cerrado, el siguiente sigue siendo el programado posterior y se puede abrir.
  assert.equal((await siguienteLanzamiento(sb, T))?.id, 'l2')
  assert.equal((await abrirSiguienteLanzamiento(sb, T, null)).nuevo.id, 'l2')
})

test('borrar: solo un programado de la propia subcuenta', async () => {
  const { sb, datos } = sbMemoria({
    launches: [
      fila({ id: 'l1', slug: 's1', label: 'Uno', fecha: '2026-10-01', opened_at: '2026-09-01T10:00:00Z' }),
      fila({ id: 'l2', slug: 's2', label: 'Dos', fecha: '2026-11-01' }),
    ],
  })
  await assert.rejects(() => borrarProgramado(sb, T, 'l1'), /Solo se puede borrar/)
  await assert.rejects(() => borrarProgramado(sb, OTRO, 'l2'), /Solo se puede borrar/)
  await borrarProgramado(sb, T, 'l2')
  assert.deepEqual(
    datos.launches.map((l) => l.id),
    ['l1']
  )
})
