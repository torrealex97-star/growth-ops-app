import assert from 'node:assert/strict'
import test from 'node:test'
import { apifyFinalStatus } from '../lib/social/apify.ts'

test('solo los estados terminales de Apify disparan la conciliación', () => {
  assert.equal(apifyFinalStatus('SUCCEEDED'), 'completed')
  assert.equal(apifyFinalStatus('FAILED'), 'failed')
  assert.equal(apifyFinalStatus('TIMED-OUT'), 'failed')
  assert.equal(apifyFinalStatus('ABORTED'), 'aborted')
  for (const status of ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING', '']) {
    assert.equal(apifyFinalStatus(status), null)
  }
})
