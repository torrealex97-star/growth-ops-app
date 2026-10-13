import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeAttendance } from '../lib/appointments/status.ts'

const appointment = (status) => ({ status })

test('show rate only uses explicit attendance outcomes', () => {
  const result = summarizeAttendance([
    appointment('show'),
    appointment('completed'),
    appointment('no_show'),
    appointment('scheduled'),
    appointment('confirmed'),
    appointment('cancelled'),
    appointment('rescheduled'),
  ])

  assert.deepEqual(result, {
    total: 7,
    eligible: 5,
    attended: 2,
    noShows: 1,
    resolved: 3,
    unresolved: 2,
    cancelled: 1,
    rescheduled: 1,
    showRate: (2 / 3) * 100,
  })
})

test('unresolved appointments return null instead of an invented 0%', () => {
  const result = summarizeAttendance([appointment('scheduled'), appointment('confirmed'), appointment(null)])
  assert.equal(result.showRate, null)
  assert.equal(result.resolved, 0)
  assert.equal(result.unresolved, 3)
})

test('legacy cancellation aliases remain excluded at read time', () => {
  const result = summarizeAttendance([
    appointment('CANCELLED'),
    appointment('canceled'),
    appointment('cancelada'),
    appointment('no_show_cancel'),
  ])
  assert.equal(result.cancelled, 4)
  assert.equal(result.eligible, 0)
  assert.equal(result.showRate, null)
})
