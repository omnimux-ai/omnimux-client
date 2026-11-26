import { useState } from 'react'
import { Button, InputField } from 'dsh-ui-kit'

/**
 * Collapsible custom-tags field. Collapsed by default; trigger toggles the InputField.
 * @param {{
 *   t: (key: string) => string,
 *   value: string,
 *   disabled?: boolean,
 *   onChange: (value: string) => void,
 * }} props
 */
export function CollapsibleTagsField({ t, value, disabled = false, onChange }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="omnimux-inspiration-tags-collapse">
      <Button
        type="button"
        variant="ghost"
        className="omnimux-inspiration-tags-toggle"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => { setExpanded((prev) => !prev) }}
      >
        <span className="omnimux-inspiration-tags-toggle-label">{t('add.tagsToggle')}</span>
        <span
          className={`omnimux-inspiration-tags-toggle-chevron${expanded ? ' is-open' : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </Button>
      {expanded ? (
        <InputField
          type="text"
          label={t('add.tagsLabel')}
          placeholder={t('add.tagsPlaceholder')}
          value={value}
          disabled={disabled}
          onChange={(e) => { onChange(e.target.value) }}
        />
      ) : null}
    </div>
  )
}
