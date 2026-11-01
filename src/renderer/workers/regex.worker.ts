import { executeRegex } from '../../shared/regex'
self.onmessage = event => {
  const { id, pattern, flags, text, replacement } = event.data
  try { self.postMessage({ id, ...executeRegex(pattern, flags, text, replacement) }) }
  catch (error) { self.postMessage({ id, error: (error as Error).message }) }
}
