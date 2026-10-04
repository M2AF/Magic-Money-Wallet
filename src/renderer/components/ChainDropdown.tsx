/**
 * ChainDropdown.tsx — custom network picker with chain logos.
 *
 * Replaces the native <select>s in the swap widget and the extension
 * NetworkSwitcher: a native popup can't show logos and renders with the OS
 * theme, not the wallet's. The menu reuses the App Hub dropdown classes
 * (.apphub-dropdown-menu / -item) so every custom dropdown in the wallet looks
 * the same.
 *
 * The menu is position: fixed and measured from the trigger, so it escapes
 * overflow clipping in narrow side-panel/header containers and flips upward
 * when there isn't room below.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { CHAIN_ICONS } from '../data/chain-icons'

export interface ChainDropdownOption {
  value: string
  label: string
  /** Chain id used to look up the bundled logo (e.g. 'base', 'abstract-agw'). */
  chain: string
  /** Fallback dot colour when no logo is bundled. */
  color?: string
}

/** Bundled logo for a chain id; variants like 'abstract-agw' share the base mark. */
export function chainIconFor(chain: string): string | undefined {
  return CHAIN_ICONS[chain] ?? CHAIN_ICONS[chain.split('-')[0]]
}

export function ChainIcon({ chain, color, size = 16 }: { chain: string; color?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [chain])
  const src = chainIconFor(chain)
  if (!src || failed) {
    const dot = Math.max(6, Math.round(size / 2))
    return (
      <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ width: dot, height: dot, borderRadius: '50%', background: color ?? 'var(--text-muted)' }} />
      </span>
    )
  }
  return (
    <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  )
}

interface Props {
  value: string
  options: ChainDropdownOption[]
  onChange: (value: string) => void
  ariaLabel: string
  /** Trigger contents; defaults to logo + label + caret. */
  renderTrigger?: (selected: ChainDropdownOption | undefined, open: boolean) => React.ReactNode
  triggerStyle?: React.CSSProperties
  title?: string
  /** Which trigger edge the menu lines up with. */
  align?: 'left' | 'right'
  menuMinWidth?: number
  /**
   * Controlled open state. The Electron browser chrome passes these so opening
   * goes through its overlay slot (detach the dApp view, paint a snapshot) —
   * otherwise the live page would cover the menu.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const MENU_MAX_HEIGHT = 300
const GAP = 4

export function ChainDropdown({
  value, options, onChange, ariaLabel, renderTrigger, triggerStyle, title,
  align = 'right', menuMinWidth = 180, open: openProp, onOpenChange,
}: Props) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = useCallback((next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }, [openProp, onOpenChange])
  const [pos, setPos] = useState<React.CSSProperties | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)
  const close = useCallback(() => setOpen(false), [setOpen])

  const measure = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(Math.max(r.width, menuMinWidth), vw - 16)
    const spaceBelow = vh - r.bottom - GAP - 8
    const spaceAbove = r.top - GAP - 8
    const up = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, up ? spaceAbove : spaceBelow))
    let left = align === 'right' ? r.right - width : r.left
    left = Math.min(Math.max(8, left), vw - width - 8)
    setPos({
      position: 'fixed', left, width, maxHeight, right: 'auto', zIndex: 300,
      ...(up ? { bottom: vh - r.top + GAP, top: 'auto' } : { top: r.bottom + GAP }),
    })
  }, [align, menuMinWidth])

  useLayoutEffect(() => { if (open) measure() }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); btnRef.current?.focus() }
    }
    // Scrolling anything but the menu itself would detach the fixed menu from its trigger.
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close])

  // Focus the active row on open so arrow keys work straight away.
  useEffect(() => {
    if (!open || !pos) return
    const active = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?? menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')
    active?.focus({ preventScroll: true })
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, pos])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0)
    items[next]?.focus()
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0, minWidth: 0 }}>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        onClick={() => setOpen(!open)}
        style={{ ...defaultTriggerStyle, ...triggerStyle }}
      >
        {renderTrigger ? renderTrigger(selected, open) : (
          <>
            {selected && <ChainIcon chain={selected.chain} color={selected.color} size={16} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected?.label ?? 'Select network'}
            </span>
            <Caret open={open} />
          </>
        )}
      </button>
      {open && pos && (
        <div ref={menuRef} role="listbox" aria-label={ariaLabel} className="apphub-dropdown-menu" style={pos} onKeyDown={onMenuKey}>
          {options.map(o => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                data-value={o.value}
                className={`apphub-dropdown-item${active ? ' active' : ''}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => { close(); if (!active) onChange(o.value); btnRef.current?.focus() }}
              >
                <ChainIcon chain={o.chain} color={o.color} size={18} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Caret({ open, size = 10 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ color: 'var(--text-muted)', flexShrink: 0, transition: 'transform var(--transition)', transform: open ? 'rotate(180deg)' : undefined }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

const defaultTriggerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, maxWidth: 170,
  padding: '5px 8px', background: 'var(--bg-surface)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', outline: 'none',
}
