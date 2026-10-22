import crypto from 'node:crypto'

// ── Base en memoria con lo justo del cliente de Supabase (select/eq/gte/order/limit/head+count/insert/update/upsert)
export class Q {
  constructor(db, t) {
    Object.assign(this, {
      db,
      t,
      f: [],
      op: 'select',
      payload: null,
      opts: null,
      uno: null,
      orden: null,
      lim: null,
      cab: false,
    })
  }
  select(_c, o) {
    if (o?.head) this.cab = true
    this.cnt = o?.count
    return this
  }
  insert(v) {
    this.op = 'insert'
    this.payload = v
    return this
  }
  upsert(v, o) {
    this.op = 'upsert'
    this.payload = v
    this.opts = o
    return this
  }
  update(v) {
    this.op = 'update'
    this.payload = v
    return this
  }
  eq(c, v) {
    this.f.push((r) => (c.includes('->>') ? r.data?.[c.split('->>')[1]] === v : r[c] === v))
    return this
  }
  neq(c, v) {
    this.f.push((r) => r[c] !== v)
    return this
  }
  in(c, vs) {
    this.f.push((r) => vs.includes(r[c]))
    return this
  }
  is(c, v) {
    this.f.push((r) => (v === null ? r[c] == null : r[c] === v))
    return this
  }
  not(c, op, v) {
    this.f.push((r) => !(op === 'is' && v === null ? r[c] == null : r[c] === v))
    return this
  }
  gte(c, v) {
    this.f.push((r) => String(r[c]) >= v)
    return this
  }
  order(c, o) {
    this.orden = [c, o?.ascending !== false]
    return this
  }
  limit(n) {
    this.lim = n
    return this
  }
  maybeSingle() {
    this.uno = 'maybe'
    return this
  }
  single() {
    this.uno = 'one'
    return this
  }
  then(res, rej) {
    return Promise.resolve(this.exec()).then(res, rej)
  }
  exec() {
    const tabla = (this.db[this.t] ??= [])
    const ok = (r) => this.f.every((fn) => fn(r))
    let filas
    if (this.op === 'insert' || this.op === 'upsert') {
      const def =
        this.t === 'conversations'
          ? {
              unread_count: 0,
              snoozed_until: null,
              last_inbound_at: null,
              last_message_at: null,
              first_reply_at: null,
              labels: [],
            }
          : {}
      const n = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...def, ...this.payload }
      const claves = this.opts?.onConflict?.split(',')
      const previa = claves && tabla.find((r) => claves.every((k) => r[k] === n[k]))
      if (previa) filas = this.opts.ignoreDuplicates ? [] : (Object.assign(previa, n, { id: previa.id }), [previa])
      else {
        tabla.push(n)
        filas = [n]
      }
    } else if (this.op === 'update') {
      filas = tabla.filter(ok)
      for (const r of filas) Object.assign(r, this.payload)
    } else {
      filas = tabla.filter(ok)
      if (this.orden)
        filas = [...filas].sort(
          (a, b) => (String(a[this.orden[0]]) < String(b[this.orden[0]]) ? -1 : 1) * (this.orden[1] ? 1 : -1)
        )
      if (this.lim != null) filas = filas.slice(0, this.lim)
    }
    if (this.cab) return { data: null, count: filas.length, error: null }
    if (this.uno) return { data: filas[0] ?? null, error: null }
    return { data: filas, error: null }
  }
}
export const cliente = (db) => ({ from: (t) => new Q(db, t) })
