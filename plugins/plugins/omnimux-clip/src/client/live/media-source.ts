const blobDigests = new WeakMap<Blob, Promise<string>>()

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function mediaDigest(value: string | Blob): Promise<string> {
  if (typeof value === 'string') return sha256(new TextEncoder().encode(value))
  const cached = blobDigests.get(value)
  if (cached) return cached
  const digest = value.arrayBuffer().then(sha256).catch(error => {
    blobDigests.delete(value)
    throw error
  })
  blobDigests.set(value, digest)
  return digest
}

export async function verifiedMediaBlob(candidate: unknown, digest: string): Promise<Blob | undefined> {
  if (!(candidate instanceof Blob) || !candidate.size || /^image\/svg/i.test(candidate.type)) return undefined
  const actual = await mediaDigest(candidate).catch(error => {
    console.debug('[Clip] Media bytes could not be verified.', (error as Error)?.name)
    return undefined
  })
  return actual === digest ? candidate : undefined
}
