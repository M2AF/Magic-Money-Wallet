/**
 * ThemeEditorModal.tsx — build or edit one custom theme.
 *
 * The user picks three colours (page background, accent, text); everything else
 * in the token set is derived from them (lib/theme-tokens.ts), which is what
 * keeps a custom theme inside the app's design language instead of turning into
 * a free-for-all recolour.
 *
 * The whole app is repainted live while the editor is open — the sheet itself
 * IS the preview — and the preview is dropped on cancel, so a theme that was
 * never saved cannot be left on screen.
 */

import { useEffect, useState } from 'react'
import { ColorPicker } from './ColorPicker'
import {
  DEFAULT_CUSTOM_COLORS,
  deleteCustomTheme,
  endPreview,
  previewCustomTheme,
  saveCustomTheme,
  setTheme,
  type CustomTheme,
  type CustomThemeColors
} from '../theme'
import { accentContrast, textContrast, toneOf } from '../lib/theme-tokens'

type Slot = keyof CustomThemeColors

const SLOTS: { key: Slot; label: string; hint: string }[] = [
  { key: 'bg',     label: 'Background', hint: 'The page behind everything. Light or dark — the rest of the app follows it.' },
  { key: 'accent', label: 'Accent',     hint: 'Buttons, highlights, borders and the active state of every control.' },
  { key: 'text',   label: 'Text',       hint: 'Body text. Secondary and muted tiers are derived from it.' }
]

interface Props {
  /** The theme being edited, or null to create a new one. */
  editing: CustomTheme | null
  onClose: () => void
  /** Fires after a successful save or delete so the picker can refresh. */
  onSaved: () => void
}

/** WCAG bands, worded for someone choosing colours rather than auditing them. */
function contrastNote(ratio: number): { text: string; level: 'good' | 'ok' | 'bad' } {
  if (ratio >= 7) return { text: 'Excellent contrast', level: 'good' }
  if (ratio >= 4.5) return { text: 'Good contrast', level: 'good' }
  if (ratio >= 3) return { text: 'Low contrast — small text will be hard to read', level: 'ok' }
  return { text: 'Very low contrast — this will be hard to read', level: 'bad' }
}

export function ThemeEditorModal({ editing, onClose, onSaved }: Props) {
  const [name, setName] = useState(editing?.name ?? 'My theme')
  const [colors, setColors] = useState<CustomThemeColors>(editing?.colors ?? DEFAULT_CUSTOM_COLORS)
  const [slot, setSlot] = useState<Slot>('bg')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Paint the app in the theme being built. endPreview() on unmount covers every
  // way out of here — Cancel, the ×, the backdrop — so only an explicit Save
  // leaves these colours applied.
  useEffect(() => {
    previewCustomTheme(colors)
  }, [colors])
  useEffect(() => () => { endPreview() }, [])

  const set = (hex: string) => setColors(c => ({ ...c, [slot]: hex }))

  const save = () => {
    const saved = saveCustomTheme({ id: editing?.id, name, colors })
    if (!saved) {
      setError('You already have six custom themes. Delete one to make room.')
      return
    }
    // Wearing it immediately is the expected outcome of building one.
    setTheme(saved.id)
    onSaved()
    onClose()
  }

  const remove = () => {
    if (!editing) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    deleteCustomTheme(editing.id)
    onSaved()
    onClose()
  }

  const active = SLOTS.find(s => s.key === slot)!
  const text = contrastNote(textContrast(colors))
  const accent = contrastNote(accentContrast(colors))
  const tone = toneOf(colors.bg)

  return (
    <div className="settings-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()}>
        <div className="settings-grip" />
        <div className="settings-header">
          <div className="settings-title">{editing ? 'Edit theme' : 'New theme'}</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="theme-editor">
          <input
            className="input"
            value={name}
            maxLength={24}
            placeholder="Theme name"
            aria-label="Theme name"
            onChange={e => { setName(e.target.value); setError(null) }}
          />

          <div className="theme-slots" role="tablist" aria-label="Which colour to edit">
            {SLOTS.map(s => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={slot === s.key}
                className={`theme-slot${slot === s.key ? ' active' : ''}`}
                onClick={() => setSlot(s.key)}
              >
                <span className="theme-slot-dot" style={{ background: colors[s.key] }} />
                <span className="theme-slot-name">{s.label}</span>
              </button>
            ))}
          </div>

          <p className="theme-slot-hint">{active.hint}</p>

          <ColorPicker value={colors[slot]} onChange={set} label={active.label} />

          <div className="theme-readout">
            <div className={`theme-contrast ${text.level}`}>
              <strong>Text</strong> {text.text} · {textContrast(colors).toFixed(1)}:1
            </div>
            <div className={`theme-contrast ${accent.level}`}>
              <strong>Accent</strong> {accent.text} · {accentContrast(colors).toFixed(1)}:1
            </div>
            <div className="theme-tone-note">
              Reading as a <strong>{tone}</strong> theme — cards, borders and shadows are
              tuned to match, exactly as the built-in themes do.
            </div>
          </div>

          {error && <div className="color-error">{error}</div>}

          <button type="button" className="btn btn-primary" onClick={save}>
            {editing ? 'Save changes' : 'Create theme'}
          </button>
          {editing && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--error)' }} onClick={remove}>
              {confirmDelete ? 'Tap again to delete' : 'Delete theme'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
