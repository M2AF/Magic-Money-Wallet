import { useEffect, useState } from 'react'
import { TEXTURES, TEXTURE_EVENT, getTexture, setTexture, textureSuspended, getTwoTone, setTwoTone } from '../lib/textures'

export function TexturePicker() {
  const [selected, update] = useState(getTexture)
  const [suspended, suspend] = useState(textureSuspended)
  const [twoTone, updateTwoTone] = useState(getTwoTone)
  useEffect(() => {
    const refresh = () => { update(getTexture()); suspend(textureSuspended()); updateTwoTone(getTwoTone()) }
    window.addEventListener(TEXTURE_EVENT, refresh)
    return () => window.removeEventListener(TEXTURE_EVENT, refresh)
  }, [])
  return (
    <div className="texture-picker">
      <div className="theme-picker-group">Texture</div>
      <div className="texture-grid" aria-label="Surface texture">
        {TEXTURES.map(texture => (
          <button type="button" key={texture.id} className="texture-choice"
            aria-pressed={selected === texture.id} title={texture.detail}
            onClick={() => setTexture(texture.id)}>
            <span className="texture-sample" data-texture={texture.id} aria-hidden="true" />
            <span>{texture.name}</span>
          </button>
        ))}
      </div>
      <button type="button" role="switch" className="surface-tone-toggle"
        aria-checked={twoTone} onClick={() => setTwoTone(!twoTone)}>
        <span>Two-tone surfaces</span><span>{twoTone ? 'On' : 'Off'}</span>
      </button>
      <p className="texture-note">{suspended
        ? 'Saved for colour themes. This art theme uses its own surfaces.'
        : twoTone ? 'Slightly raised card colours. Works with Glass and every flat finish.'
        : 'Cards use the background colour. Works with Glass and every flat finish.'}</p>
    </div>
  )
}
