import orbitUrl from '../assets/themes/sovereign/orbit.svg'

let activeController: (() => void) | null = null

/** Presentation only. No wallet data, timers, provider calls or click handlers. */
export function initSovereignMotion(): () => void {
  if (activeController) return activeController
  const root = document.documentElement
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let scene: HTMLDivElement | null = null
  let frame = 0
  let point: { x: number; y: number; target: EventTarget | null } | null = null
  let lit: HTMLElement | null = null
  let listening = false
  const ripples = new Set<HTMLSpanElement>()
  const selected = () => root.dataset.theme === 'sovereign' && !root.hasAttribute('data-derived')
  const running = () => selected() && !reduced.matches && !document.hidden
  const clearLight = () => {
    lit?.style.removeProperty('--sv-x')
    lit?.style.removeProperty('--sv-y')
    lit = null
  }
  const clearFrame = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0; point = null
    clearLight()
    root.style.removeProperty('--sv-pointer-x')
    root.style.removeProperty('--sv-pointer-y')
    for (const ripple of ripples) ripple.remove()
    ripples.clear()
  }
  const move = (event: PointerEvent) => {
    // Touch scroll remains native; presses still receive a small visual response.
    if (event.pointerType === 'touch') return
    point = { x: event.clientX, y: event.clientY, target: event.target }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!point || !running()) return
      const { x, y, target } = point
      root.style.setProperty('--sv-pointer-x', `${x}px`)
      root.style.setProperty('--sv-pointer-y', `${y}px`)
      const surface = target instanceof Element
        ? target.closest<HTMLElement>('.chain-card, .card, .art-panel, .art-swap, .settings-group, .art-theme-sovereign, .browser-toolbar') : null
      if (lit !== surface) clearLight()
      lit = surface
      if (surface) {
        const rect = surface.getBoundingClientRect()
        surface.style.setProperty('--sv-x', `${Math.max(0, Math.min(100, (x - rect.left) / rect.width * 100))}%`)
        surface.style.setProperty('--sv-y', `${Math.max(0, Math.min(100, (y - rect.top) / rect.height * 100))}%`)
      }
    })
  }
  const press = (event: PointerEvent) => {
    if (!running() || event.button !== 0) return
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return
    // A bounded, noninteractive overlay; it never changes the action's geometry.
    if (ripples.size >= 6) { const oldest = ripples.values().next().value; if (oldest) { oldest.remove(); ripples.delete(oldest) } }
    const ripple = document.createElement('span')
    ripple.className = 'sv-ripple'; ripple.setAttribute('aria-hidden', 'true')
    ripple.style.left = `${event.clientX}px`; ripple.style.top = `${event.clientY}px`
    document.body.append(ripple); ripples.add(ripple)
    ripple.addEventListener('animationend', () => { ripple.remove(); ripples.delete(ripple) }, { once: true })
  }
  const leave = () => clearFrame()
  const listen = (enabled: boolean) => {
    if (listening === enabled) return
    listening = enabled
    if (enabled) {
      document.addEventListener('pointermove', move, { passive: true })
      document.addEventListener('pointerdown', press, { passive: true })
      document.addEventListener('pointerleave', leave)
    } else {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('pointerleave', leave)
      clearFrame()
    }
  }
  const update = () => {
    if (selected()) {
      if (!scene && document.body) {
        scene = document.createElement('div')
        scene.className = 'sv-scene'; scene.setAttribute('aria-hidden', 'true'); scene.inert = true
        const aura = document.createElement('div'); aura.className = 'sv-aura'
        const orbit = document.createElement('img'); orbit.className = 'sv-orbit'; orbit.src = orbitUrl; orbit.alt = ''; orbit.draggable = false
        const light = document.createElement('div'); light.className = 'sv-light'
        scene.append(aura, orbit, light); document.body.prepend(scene)
      }
      root.dataset.svMotion = running() ? 'running' : 'paused'
      listen(running())
    } else {
      listen(false); clearFrame()
      scene?.remove(); scene = null
      delete root.dataset.svMotion
    }
  }
  // Observe only the two theme attributes, never pointer styles or the DOM tree.
  const observer = new MutationObserver(update)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-derived'] })
  reduced.addEventListener('change', update)
  document.addEventListener('visibilitychange', update)
  document.addEventListener('DOMContentLoaded', update, { once: true })
  update()
  activeController = () => {
    activeController = null
    observer.disconnect(); listen(false); clearFrame(); scene?.remove()
    delete root.dataset.svMotion
    reduced.removeEventListener('change', update)
    document.removeEventListener('visibilitychange', update)
    document.removeEventListener('DOMContentLoaded', update)
  }
  return activeController
}
