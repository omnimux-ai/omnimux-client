export async function mediaDigest(value: string | Blob): Promise<string> {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer()
  const bytes = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
