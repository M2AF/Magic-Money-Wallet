/**
 * ThemeEditorModal.tsx — build a custom theme, or recolour a built-in one.
 *
 * The user picks three colours (page background, accent, text); everything else
 * in the token set is derived from them (lib/theme-tokens.ts), which is what
 * keeps a theme inside the app's design language instead of turning into a
 * free-for-all recolour.
 *
 * A built-in is edited through exactly the same three controls. The difference
 * is what saving costs and what it can undo: the shipped colours are never
 * overwritten, only shadowed by an override, so Revert is always available and
 * always exact. Its name is fixed — a built-in is a shipped identity, and the
 * six custom slots are where a user's own names belong.
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
  getBuiltinColors,
  isBuiltinEdited,
  previewCustomTheme,
  resetBuiltinTheme,
  saveBuiltinTheme,
  saveCustomTheme,
  setTheme,
  type CustomTheme,
  type CustomThemeColors,
  type ThemeDef
} from '../theme'
import { accentContrast, textContrast, toneOf } from '../lib/theme-tokens'

type Slot = keyof CustomThemeColors

const SLOTS: { key: Slot; label: string; hint: string }[] = [
  { key: 'bg',     label: 'Background', hint: 'The page behind everything. Light or dark — the rest of the app follows it.' },
  { key: 'accent', label: 'Accent',     hint: 'Buttons, highlights, borders and the active state of every control.' },
  { key: 'text',   label: 'Text',       hint: 'Body text. Secondary and muted tiers are derived from it.' }
]

/** What the sheet was opened on. */
export type ThemeEditorTarget =
  | { kind: 'new' }
  | { kind: 'custom'; theme: CustomTheme }
  | { kind: 'builtin'; def: ThemeDef }

interface Props {
  target: ThemeEditorTarget
  onClose: () => void
  /** Fires after a successful save, delete or revert so the picker can refresh. */
  onSaved: () => void
}

/** WCAG bands, worded for someone choosing colours rather than auditing them. */
function contrastNote(ratio: number): { text: string; level: 'good' | 'ok' | 'bad' } {
  if (ratio >= 7) return { text: 'Excellent contrast', level: 'good' }
  if (ratio >= 4.5) return { text: 'Good contrast', level: 'good' }
  if (ratio >= 3) return { text: 'Low contrast — small text will be hard to read', level: 'ok' }
  return { text: 'Very low contrast — this will be hard to read', level: 'bad' }
}

function initialColors(target: ThemeEditorTarget): CustomThemeColors {
  if (target.kind === 'builtin') return getBuiltinColors(target.def.id)
  if (target.kind === 'custom') return target.theme.colors
  return DEFAULT_CUSTOM_COLORS
}

export function ThemeEditorModal({ target, onClose, onSaved }: Props) {
  const builtin = target.kind === 'builtin' ? target.def : null
  const custom = target.kind === 'custom' ? target.theme : null

  const [name, setName] = useState(builtin?.name ?? custom?.name ?? 'My theme')
  const [colors, setColors] = useState<CustomThemeColors>(() => initialColors(target))
  const [slot, setSlot] = useState<Slot>('bg')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Read once, on open: the sheet is the only thing that can change it, and it
  // decides whether Revert is offered at all.
  const [wasEdited] = useState(() => (builtin ? isBuiltinEdited(builtin.id) : false))

  // Paint the app in the theme being built. endPreview() on unmount covers every
  // way out of here — Cancel, the ×, the backdrop — so only an explicit Save
  // leaves these colours applied.
  useEffect(() => {
    previewCustomTheme(colors)
  }, [colors])
  useEffect(() => () => { endPreview() }, [])

  const set = (hex: string) => setColors(c => ({ ...c, [slot]: hex }))

  const save = () => {
    if (builtin) {
      saveBuiltinTheme(builtin.id, colors)
      setTheme(builtin.id)
      onSaved()
      onClose()
      return
    }
    const saved = saveCustomTheme({ id: custom?.id, name, colors })
    if (!saved) {
      setError('You already have six custom themes. Delete one to make room.')
      return
    }
    // Wearing it immediately is the expected outcome of building one.
    setTheme(saved.id)
    onSaved()
    onClose()
  }

  const revert = () => {
    if (!builtin) return
    resetBuiltinTheme(builtin.id)
    setTheme(builtin.id)
    onSaved()
    onClose()
  }

  const remove = () => {
    if (!custom) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    deleteCustomTheme(custom.id)
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
          <div className="settings-title">
            {builtin ? `Recolour ${builtin.name}` : custom ? 'Edit theme' : 'New theme'}
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="theme-editor">
          {builtin ? (
            <p className="theme-slot-hint">
              {builtin.css
                ? 'Saving re-derives this built-in from your three colours, in place of its hand-tuned original. Revert brings the original back, exactly as it shipped.'
                : 'Saving keeps the name and gives it your colours. Revert brings the shipped ones back at any time.'}
            </p>
          ) : (
            <input
              className="input"
              value={name}
              maxLength={24}
              placeholder="Theme name"
              aria-label="Theme name"
              onChange={e => { setName(e.target.value); setError(null) }}
            />
          )}

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
              tuned to match{builtin ? '.' : ', exactly as the built-in themes do.'}
            </div>
          </div>

          {error && <div className="color-error">{error}</div>}

          <button type="button" className="btn btn-primary" onClick={save}>
            {builtin ? 'Save colours' : custom ? 'Save changes' : 'Create theme'}
          </button>
          {builtin && wasEdited && (
            <button type="button" className="btn btn-ghost" onClick={revert}>
              Revert to default
            </button>
          )}
          {custom && (
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
