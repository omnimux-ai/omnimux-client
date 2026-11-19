/** Wire format used for Desktop events sent to Umami. */
export const DEFAULT_ANALYTICS_HOSTNAME = 'omnimux-desktop'
export const DEFAULT_ANALYTICS_URL = 'omnimux://desktop'
export const DEFAULT_ANALYTICS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

interface UmamiEvent {
  website: string
  hostname: string
  url: string
  name: string
  data: Record<string, unknown>
}

export function umamiEventRequest(payload: UmamiEvent, userAgent: string, signal: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'x-umami-website-id': payload.website,
      'x-umami-hostname': payload.hostname,
    },
    body: JSON.stringify({ type: 'event', payload }),
    signal,
  }
}
