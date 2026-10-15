import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = readFileSync('.github/workflows/backup-nocturno.yml', 'utf8')

test('el backup se cifra antes de subirse y no deja el volcado en claro', () => {
  assert.match(wf, /--symmetric --cipher-algo AES256/)
  assert.match(wf, /rm -f "\$f\.dump"/)
  assert.match(wf, /path: \$\{\{ env\.FILE \}\}/)
})

test('falla sin secretos y rechaza volcados vacíos', () => {
  assert.match(wf, /Faltan BACKUP_DATABASE_URL/)
  assert.match(wf, /\[ "\$n" -ge 20 \]/)
})
