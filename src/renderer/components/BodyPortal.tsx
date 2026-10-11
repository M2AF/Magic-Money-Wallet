import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders a full-screen overlay (modal, sheet, picker) as a child of <body>.
 *
 * `position: fixed` is only relative to the viewport when no ancestor has a
 * transform, filter or backdrop-filter. The Glass finish (the default) and the
 * art/material themes put backdrop-filter on cards, so an overlay rendered
 * inside one was boxed into that card and slid under the header. React still
 * bubbles events from a portal through the component tree, so handlers above
 * the overlay keep working.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
