import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { formatPreview, formatRC, parseResponse, SAFE } from '../web/src/lib/protocol.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binary = '/tmp/rc-firmware-bridge'
if (!process.argv.includes('--input') && !process.argv.includes('--verify')) execFileSync('g++', ['-std=c++17', '-I', 'tests/firmware_stubs', 'tests/firmware_bridge.cpp', '-o', binary], { cwd: root })
const active = [
  { roll: 1700, pitch: 1500, throttle: 1000, yaw: 1500 },
  { roll: 1500, pitch: 1800, throttle: 1000, yaw: 1500 },
  { roll: 1500, pitch: 1500, throttle: 1400, yaw: 1500 },
  { roll: 1500, pitch: 1500, throttle: 1000, yaw: 1200 },
  { roll: 1900, pitch: 1100, throttle: 1500, yaw: 1600 },
]
const steps = [
  [0, formatRC(SAFE)], [10, 'ENABLE\n'],
  ...active.map((channels, index) => [20 + index, formatRC(channels)]),
  [30, 'RC,1000,1500\n'], [31, 'RC,1500,1500,1000,1500X\n'], [32, 'RC,999,1500,1000,1500\n'],
  [333, formatRC(active[0])], [340, 'RESET,1500,1500,1000,1500\n'],
  [341, 'ENABLE\n'], [342, formatRC(SAFE)], [343, 'ENABLE\n'],
  [344, 'STOP\n'], [345, formatRC(active[2])], [350, 'RESET,1500,1500,1000,1500\n'],
  ...active.map((values, index) => [351 + index, formatPreview(values)]),
  [650, formatPreview(active[0])], [651, 'STOP\n'], [652, formatPreview(active[4])],
  [653, 'PREVIEW,999,1500,1500,1500\n'],
]
const input = steps.map(([time, command]) => `${time} ${String(command).trim()}`).join('\n') + '\n'
if (process.argv.includes('--input')) { process.stdout.write(input); process.exit(0) }
const run = process.argv.includes('--verify') ? { status: 0, stdout: readFileSync(process.argv[process.argv.indexOf('--verify') + 1], 'utf8'), stderr: '' } : spawnSync(binary, { input, encoding: 'utf8' })
assert.equal(run.status, 0, run.stderr)
const lines = run.stdout.trim().split('\n')
const responses = new Map()
const snapshots = new Map()
for (const line of lines) {
  const parts = line.split(',')
  const step = Number(parts[1])
  if (parts[0] === 'RX') responses.set(step, [...(responses.get(step) ?? []), parts.slice(2).join(',')])
  else if (parts[0] === 'STEP') snapshots.set(step, { state: parts[2], pins: parts.slice(3).map(x => x.split(':').map(Number)) })
}
function expectStep(index, state, values, response) {
  const snap = snapshots.get(index)
  assert.equal(snap?.state, state, `state at step ${index}`)
  assert.deepEqual(snap?.pins, [[3, values.roll], [5, values.pitch], [6, values.throttle], [9, values.yaw]], `pulse commands at step ${index}`)
  if (response) assert.ok(responses.get(index)?.includes(response), `response ${response} at step ${index}: ${responses.get(index)}`)
}
expectStep(0, 'SAFE', SAFE, 'ACK,1500,1500,1000,1500')
expectStep(1, 'ACTIVE', SAFE, 'STATE,ACTIVE')
active.forEach((channels, index) => {
  const step = index + 2
  expectStep(step, 'ACTIVE', channels, `ACK,${channels.roll},${channels.pitch},${channels.throttle},${channels.yaw}`)
  const ack = responses.get(step)?.find(line => line.startsWith('ACK,'))
  assert.deepEqual(parseResponse(ack).values, channels)
})
for (let step = 7; step <= 9; ++step) expectStep(step, 'ACTIVE', active[4], 'ERR,INVALID_RC')
expectStep(10, 'FAILSAFE', SAFE, 'ERR,LATCHED')
expectStep(11, 'SAFE', SAFE, 'STATE,SAFE')
expectStep(12, 'SAFE', SAFE, 'ERR,ENABLE_REQUIRES_FRESH_NEUTRAL')
expectStep(13, 'SAFE', SAFE, 'ACK,1500,1500,1000,1500')
expectStep(14, 'ACTIVE', SAFE, 'STATE,ACTIVE')
expectStep(15, 'STOPPED', SAFE, 'STATE,STOPPED')
expectStep(16, 'STOPPED', SAFE, 'ERR,LATCHED')
expectStep(17, 'SAFE', SAFE, 'STATE,SAFE')
active.forEach((values, index) => expectStep(18 + index, 'SAFE', SAFE, formatPreview(values).trim().replace('PREVIEW,', 'PREVIEW_ACK,')))
expectStep(23, 'FAILSAFE', SAFE, 'STATE,FAILSAFE')
expectStep(24, 'STOPPED', SAFE, 'STATE,STOPPED')
expectStep(25, 'STOPPED', SAFE, 'PREVIEW_ACK,1900,1100,1500,1600')
expectStep(26, 'STOPPED', SAFE, 'ERR,INVALID_PREVIEW')
console.log('Frontend protocol → real sketch parser/state/output integration passed (27 steps)')
