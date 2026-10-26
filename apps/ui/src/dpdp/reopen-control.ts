/**
 * Persistent "Privacy choices" button for DPDP visitors who have already decided, so that
 * withdrawing consent is as easy as giving it: one click reopens the preference modal from any
 * page. A real `<button>` (keyboard and screen-reader operable), fixed in a corner, out of the way.
 */

import { isClient } from '../utils/ssr'

export const DPDP_REOPEN_ID = 'consenti-dpdp-reopen'

export class DpdpReopenControl {
  private button: HTMLButtonElement | null = null

  mount(parent: HTMLElement, label: string, ariaLabel: string, onOpen: (trigger: HTMLElement) => void): void {
    if (!isClient()) return
    this.unmount()
    const button = document.createElement('button')
    button.type = 'button'
    button.id = DPDP_REOPEN_ID
    button.className = 'consenti-dpdp-reopen'
    button.textContent = label
    button.setAttribute('aria-label', ariaLabel)
    button.setAttribute('aria-haspopup', 'dialog')
    button.addEventListener('click', () => onOpen(button))
    parent.appendChild(button)
    this.button = button
  }

  setHidden(hidden: boolean): void {
    if (this.button) this.button.hidden = hidden
  }

  isMounted(): boolean {
    return this.button !== null && this.button.isConnected
  }

  unmount(): void {
    this.button?.remove()
    this.button = null
  }
}
