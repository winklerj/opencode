import type { ElementInfo, SelectionResult } from "./types"
import { extractFromElement, detectReact } from "./dom-extractor"

/**
 * Selection overlay for Chrome Extension.
 *
 * Provides a visual UI for selecting elements on the page and extracting
 * their DOM/React tree information for the AI agent.
 */

interface OverlayStyles {
  highlightColor: string
  highlightBorderWidth: number
  selectedColor: string
  labelBackground: string
  labelColor: string
  labelFontSize: number
}

const DEFAULT_STYLES: OverlayStyles = {
  highlightColor: "rgba(59, 130, 246, 0.3)",
  highlightBorderWidth: 2,
  selectedColor: "rgba(34, 197, 94, 0.3)",
  labelBackground: "rgba(0, 0, 0, 0.8)",
  labelColor: "#ffffff",
  labelFontSize: 12,
}

export class SelectionOverlay {
  private overlay: HTMLDivElement | null = null
  private highlightBox: HTMLDivElement | null = null
  private label: HTMLDivElement | null = null
  private selectedElements: Set<Element> = new Set()
  private selectedBoxes: Map<Element, HTMLDivElement> = new Map()
  private hoveredElement: Element | null = null
  private isActive: boolean = false
  private styles: OverlayStyles

  private onHover?: (element: ElementInfo | null) => void
  private onSelect?: (elements: ElementInfo[]) => void
  private onComplete?: (result: SelectionResult) => void
  private onCancel?: () => void

  constructor(styles: Partial<OverlayStyles> = {}) {
    this.styles = { ...DEFAULT_STYLES, ...styles }
  }

  /**
   * Start selection mode
   */
  start(options?: {
    onHover?: (element: ElementInfo | null) => void
    onSelect?: (elements: ElementInfo[]) => void
    onComplete?: (result: SelectionResult) => void
    onCancel?: () => void
  }): void {
    if (this.isActive) return

    this.onHover = options?.onHover
    this.onSelect = options?.onSelect
    this.onComplete = options?.onComplete
    this.onCancel = options?.onCancel

    this.createOverlay()
    this.attachListeners()
    this.isActive = true
  }

  /**
   * Stop selection mode
   */
  stop(): void {
    if (!this.isActive) return

    this.removeListeners()
    this.removeOverlay()
    this.clearSelection()
    this.isActive = false
  }

  /**
   * Complete selection and return result
   */
  complete(): SelectionResult | null {
    if (!this.isActive) return null

    const elements: ElementInfo[] = []
    for (const element of this.selectedElements) {
      const info = extractFromElement(element)
      if (info) {
        elements.push(info)
      }
    }

    const reactInfo = detectReact()

    const result: SelectionResult = {
      elements,
      pageUrl: window.location.href,
      pageTitle: document.title,
      timestamp: Date.now(),
      hasReact: reactInfo.hasReact,
      reactVersion: reactInfo.version,
    }

    this.onComplete?.(result)
    this.stop()

    return result
  }

  /**
   * Cancel selection
   */
  cancel(): void {
    this.onCancel?.()
    this.stop()
  }

  /**
   * Get currently selected elements
   */
  getSelectedElements(): Element[] {
    return Array.from(this.selectedElements)
  }

  /**
   * Clear all selections
   */
  clearSelection(): void {
    this.selectedElements.clear()
    for (const box of this.selectedBoxes.values()) {
      box.remove()
    }
    this.selectedBoxes.clear()
  }

  /**
   * Check if selection mode is active
   */
  get active(): boolean {
    return this.isActive
  }

  // Private methods

  private createOverlay(): void {
    // Create main overlay container
    this.overlay = document.createElement("div")
    this.overlay.id = "opencode-selection-overlay"
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `

    // Create highlight box for hover
    this.highlightBox = document.createElement("div")
    this.highlightBox.style.cssText = `
      position: absolute;
      pointer-events: none;
      background-color: ${this.styles.highlightColor};
      border: ${this.styles.highlightBorderWidth}px solid rgb(59, 130, 246);
      box-sizing: border-box;
      display: none;
      transition: all 0.1s ease-out;
    `

    // Create label for component info
    this.label = document.createElement("div")
    this.label.style.cssText = `
      position: absolute;
      background-color: ${this.styles.labelBackground};
      color: ${this.styles.labelColor};
      font-size: ${this.styles.labelFontSize}px;
      font-family: monospace;
      padding: 2px 6px;
      border-radius: 2px;
      white-space: nowrap;
      display: none;
      pointer-events: none;
    `

    this.overlay.appendChild(this.highlightBox)
    this.overlay.appendChild(this.label)
    document.body.appendChild(this.overlay)
  }

  private removeOverlay(): void {
    this.overlay?.remove()
    this.overlay = null
    this.highlightBox = null
    this.label = null
  }

  private attachListeners(): void {
    document.addEventListener("mousemove", this.handleMouseMove, { capture: true })
    document.addEventListener("click", this.handleClick, { capture: true })
    document.addEventListener("keydown", this.handleKeyDown, { capture: true })
    document.addEventListener("scroll", this.handleScroll, { capture: true, passive: true })
  }

  private removeListeners(): void {
    document.removeEventListener("mousemove", this.handleMouseMove, { capture: true })
    document.removeEventListener("click", this.handleClick, { capture: true })
    document.removeEventListener("keydown", this.handleKeyDown, { capture: true })
    document.removeEventListener("scroll", this.handleScroll, { capture: true })
  }

  private handleMouseMove = (e: MouseEvent): void => {
    const target = document.elementFromPoint(e.clientX, e.clientY)
    if (!target || target === this.overlay || this.overlay?.contains(target)) {
      return
    }

    // Skip if same element
    if (target === this.hoveredElement) return

    this.hoveredElement = target
    this.updateHighlight(target)

    // Emit hover event with element info
    const info = extractFromElement(target, { maxDepth: 2 })
    this.onHover?.(info)
  }

  private handleClick = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()

    const target = document.elementFromPoint(e.clientX, e.clientY)
    if (!target || target === this.overlay || this.overlay?.contains(target)) {
      return
    }

    // Toggle selection
    if (this.selectedElements.has(target)) {
      this.deselectElement(target)
    } else {
      this.selectElement(target)
    }

    // Emit select event with all selected elements
    const elements: ElementInfo[] = []
    for (const element of this.selectedElements) {
      const info = extractFromElement(element)
      if (info) {
        elements.push(info)
      }
    }
    this.onSelect?.(elements)
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault()
      this.cancel()
    } else if (e.key === "Enter") {
      e.preventDefault()
      this.complete()
    }
  }

  private handleScroll = (): void => {
    // Update highlight position on scroll
    if (this.hoveredElement) {
      this.updateHighlight(this.hoveredElement)
    }

    // Update selected boxes positions
    for (const [element, box] of this.selectedBoxes) {
      this.updateBoxPosition(box, element)
    }
  }

  private updateHighlight(element: Element): void {
    if (!this.highlightBox || !this.label) return

    const rect = element.getBoundingClientRect()

    this.highlightBox.style.left = `${rect.left}px`
    this.highlightBox.style.top = `${rect.top}px`
    this.highlightBox.style.width = `${rect.width}px`
    this.highlightBox.style.height = `${rect.height}px`
    this.highlightBox.style.display = "block"

    // Update label
    const info = extractFromElement(element, { maxDepth: 0, includeReact: true })
    let labelText = element.tagName.toLowerCase()
    if (info?.reactComponent?.name && info.reactComponent.name !== "Anonymous") {
      labelText = `<${info.reactComponent.name}>`
    } else if (element.id) {
      labelText += `#${element.id}`
    } else if (element.className) {
      const firstClass = element.className.split(" ")[0]
      if (firstClass) {
        labelText += `.${firstClass}`
      }
    }

    this.label.textContent = labelText
    this.label.style.left = `${rect.left}px`
    this.label.style.top = `${Math.max(0, rect.top - 20)}px`
    this.label.style.display = "block"
  }

  private selectElement(element: Element): void {
    this.selectedElements.add(element)

    const box = document.createElement("div")
    box.style.cssText = `
      position: absolute;
      pointer-events: none;
      background-color: ${this.styles.selectedColor};
      border: ${this.styles.highlightBorderWidth}px solid rgb(34, 197, 94);
      box-sizing: border-box;
    `

    this.updateBoxPosition(box, element)
    this.overlay?.appendChild(box)
    this.selectedBoxes.set(element, box)
  }

  private deselectElement(element: Element): void {
    this.selectedElements.delete(element)

    const box = this.selectedBoxes.get(element)
    box?.remove()
    this.selectedBoxes.delete(element)
  }

  private updateBoxPosition(box: HTMLDivElement, element: Element): void {
    const rect = element.getBoundingClientRect()
    box.style.left = `${rect.left}px`
    box.style.top = `${rect.top}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }
}

/**
 * Create a selection overlay with default configuration
 */
export function createSelectionOverlay(styles?: Partial<OverlayStyles>): SelectionOverlay {
  return new SelectionOverlay(styles)
}
