// Bound individual lines, not USB chunks (one chunk can contain many ACKs).
export function createLineReader(receive: (line: string) => void, overflow: () => void) {
  let buffer = ''
  let discarding = false
  return (chunk: string) => {
    for (const character of chunk) {
      if (character === '\n') {
        if (!discarding && buffer.trim()) receive(buffer.trim())
        buffer = ''; discarding = false
      } else if (!discarding) {
        buffer += character
        if (buffer.length > 512) { buffer = ''; discarding = true; overflow() }
      }
    }
  }
}
