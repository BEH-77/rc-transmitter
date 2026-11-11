import { expect, it } from 'vitest'
import { createLineReader } from '../lib/serialLines'
it('accepts many complete ACKs in one USB chunk and fragmented CRLF lines', () => {
  const lines: string[] = []
  const consume = createLineReader(line => lines.push(line), () => { throw new Error('unexpected overflow') })
  consume('ACK,1500,1500,1000,1500\n'.repeat(40))
  consume('STATE,AC'); consume('TIVE\r\n')
  expect(lines).toHaveLength(41)
  expect(lines[40]).toBe('STATE,ACTIVE')
})
it('discards an entire oversized line, including a valid-looking suffix', () => {
  const lines: string[] = []; let errors = 0
  const consume = createLineReader(line => lines.push(line), () => errors++)
  consume('x'.repeat(513)); consume('STATE,ACTIVE\nSTATE,SAFE\n')
  expect(errors).toBe(1)
  expect(lines).toEqual(['STATE,SAFE'])
})
