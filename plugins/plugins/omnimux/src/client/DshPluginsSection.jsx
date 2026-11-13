import { useEffect, useState } from 'react'

// Read-only bundle inventory (PRD D1): install / remove actions live on the
// Apps shelf cards. This Settings tab only lists what the omnimux profile
// holds, including protected bundles.
const page = {
  padding: '16px 20px',
  color: 'var(--dsw-text-primary, inherit)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 560,
}

const muted = { color: 'var(--dsw-text-secondary, inherit)', lineHeight: 1.5, margin: 0 }
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }

/**
 * @param {{ t: (key: string) => string }} props
 */
export function DshPluginsSection({ t }) {
  const [available, setAvailable] = useState(false)
  const [plugins, setPlugins] = useState([])
  const [error, setError] = useState('')

  const refresh = () => {
    return fetch('/omnimux/plugins').then(async (response) => {
      let json = {}
      try {
        json = await response.json()
      } catch {
        json = { error: `HTTP ${String(response.status)}` }
      }
      setAvailable(json.available === true)
      setPlugins(Array.isArray(json.plugins) ? json.plugins : [])
      if (!response.ok && typeof json.error === 'string' && json.error) setError(json.error)
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!available && plugins.length === 0 && error === '') {
    return (
      <div className="omnimux-dsh-plugins-page">
        <h2 className="omnimux-dsh-plugins-title">{t('dshPlugins.title')}</h2>
        <p className="omnimux-dsh-plugins-muted">{t('dshPlugins.desktopOnly')}</p>
      </div>
    )
  }

  return (
    <div className="omnimux-dsh-plugins-page">
      <h2 className="omnimux-dsh-plugins-title">{t('dshPlugins.title')}</h2>
      <p className="omnimux-dsh-plugins-muted">{t('dshPlugins.readonlyHint')}</p>
      <ul className="omnimux-dsh-plugins-list">
        {plugins.map((plugin) => (
          <li key={plugin.name} className="omnimux-dsh-plugins-row">
            <span>{plugin.name}{plugin.protected ? ` (${t('dshPlugins.protected')})` : ''}</span>
          </li>
        ))}
      </ul>
      {error !== '' ? <p className="omnimux-dsh-plugins-muted">{error}</p> : null}
    </div>
  )
}
