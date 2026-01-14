import type { ElementInfo } from "./types"

/**
 * DOM and React tree extractor for Chrome Extension.
 *
 * Extracts semantic information from DOM elements, including React component
 * data when available. This provides the AI agent with precise context about
 * UI structure without requiring actual screenshots.
 */

interface ExtractorOptions {
  /** Maximum tree depth to traverse */
  maxDepth?: number
  /** Maximum text content length per element */
  maxTextLength?: number
  /** Include computed styles */
  includeStyles?: boolean
  /** Include React component info if available */
  includeReact?: boolean
}

const DEFAULT_OPTIONS: Required<ExtractorOptions> = {
  maxDepth: 10,
  maxTextLength: 100,
  includeStyles: true,
  includeReact: true,
}

/**
 * CSS properties to extract from computed styles
 */
const RELEVANT_STYLE_PROPERTIES = [
  "display",
  "position",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
] as const

/**
 * Get the React fiber node from a DOM element
 */
function getReactFiber(node: Node): unknown | null {
  const keys = Object.keys(node)
  const fiberKey = keys.find((k) => k.startsWith("__reactFiber$"))
  return fiberKey ? (node as unknown as Record<string, unknown>)[fiberKey] : null
}

/**
 * Get the React internal instance from a DOM element (React 15-16)
 */
function getReactInternalInstance(node: Node): unknown | null {
  const keys = Object.keys(node)
  const instanceKey = keys.find((k) => k.startsWith("__reactInternalInstance$"))
  return instanceKey ? (node as unknown as Record<string, unknown>)[instanceKey] : null
}

/**
 * Get component name from React fiber
 */
function getFiberName(fiber: unknown): string {
  if (!fiber || typeof fiber !== "object") return "Anonymous"

  const f = fiber as Record<string, unknown>
  const type = f.type

  if (typeof type === "string") return type
  if (type && typeof type === "object") {
    const t = type as Record<string, unknown>
    if (t.displayName && typeof t.displayName === "string") return t.displayName
    if (t.name && typeof t.name === "string") return t.name
  }
  if (type && typeof type === "function") {
    const fn = type as { displayName?: string; name?: string }
    if (fn.displayName) return fn.displayName
    if (fn.name) return fn.name
  }

  return "Anonymous"
}

/**
 * Sanitize props to remove functions and circular references
 */
function sanitizeProps(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== "object") return {}

  const sanitized: Record<string, unknown> = {}
  const seen = new WeakSet()

  for (const [key, value] of Object.entries(props)) {
    // Skip internal React props
    if (key.startsWith("__") || key === "children") continue

    // Skip functions
    if (typeof value === "function") {
      sanitized[key] = "[function]"
      continue
    }

    // Skip DOM elements
    if (value instanceof Element || value instanceof Node) {
      sanitized[key] = "[element]"
      continue
    }

    // Handle objects (check for circular refs)
    if (value && typeof value === "object") {
      if (seen.has(value as object)) {
        sanitized[key] = "[circular]"
        continue
      }
      seen.add(value as object)

      try {
        // Try to serialize to check if it's safe
        JSON.stringify(value)
        sanitized[key] = value
      } catch {
        sanitized[key] = "[object]"
      }
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Extract React state from fiber's memoizedState
 */
function extractState(memoizedState: unknown): Record<string, unknown> | undefined {
  if (!memoizedState) return undefined

  // useState hooks store state in linked list
  const state: Record<string, unknown> = {}
  let hookIndex = 0
  let current: unknown = memoizedState

  while (current && typeof current === "object" && hookIndex < 10) {
    const hook = current as { memoizedState?: unknown; next?: unknown; baseState?: unknown }

    if (hook.memoizedState !== undefined) {
      try {
        const serialized = JSON.stringify(hook.memoizedState)
        if (serialized.length < 1000) {
          state[`hook_${hookIndex}`] = hook.memoizedState
        }
      } catch {
        // Skip non-serializable state
      }
    }

    current = hook.next
    hookIndex++
  }

  return Object.keys(state).length > 0 ? state : undefined
}

/**
 * Get React component info using DevTools global hook if available
 */
function getComponentFromDevTools(element: Element): ElementInfo["reactComponent"] | null {
  const hook = (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | { getFiberForNode?: (node: Node) => unknown }
    | undefined

  if (!hook?.getFiberForNode) return null

  const fiber = hook.getFiberForNode(element)
  if (!fiber || typeof fiber !== "object") return null

  const f = fiber as Record<string, unknown>

  const source = f._debugSource as
    | { fileName?: string; lineNumber?: number; columnNumber?: number }
    | undefined
  const owner = f._debugOwner as Record<string, unknown> | undefined

  return {
    name: getFiberName(fiber),
    props: sanitizeProps(f.memoizedProps),
    state: extractState(f.memoizedState),
    source: source
      ? {
          fileName: source.fileName ?? "",
          lineNumber: source.lineNumber ?? 0,
          columnNumber: source.columnNumber,
        }
      : undefined,
    owner: owner ? getFiberName(owner) : undefined,
  }
}

/**
 * Extract React component info from a DOM element
 */
function extractReactInfo(element: Element): ElementInfo["reactComponent"] | null {
  // Try DevTools hook first (most reliable)
  const devToolsInfo = getComponentFromDevTools(element)
  if (devToolsInfo) return devToolsInfo

  // Fall back to fiber inspection
  const fiber = getReactFiber(element) || getReactInternalInstance(element)
  if (!fiber || typeof fiber !== "object") return null

  const f = fiber as Record<string, unknown>

  return {
    name: getFiberName(fiber),
    props: sanitizeProps(f.memoizedProps || f.pendingProps),
    state: extractState(f.memoizedState),
    source: undefined,
    owner: undefined,
  }
}

/**
 * Extract relevant CSS properties from computed styles
 */
function extractStyles(
  element: Element,
): ElementInfo["computedStyles"] | undefined {
  try {
    const styles = globalThis.getComputedStyle(element)
    const result: Record<string, string> = {}

    for (const prop of RELEVANT_STYLE_PROPERTIES) {
      const value = styles.getPropertyValue(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))
      if (value && value !== "none" && value !== "normal" && value !== "auto") {
        result[prop] = value
      }
    }

    return Object.keys(result).length > 0 ? (result as ElementInfo["computedStyles"]) : undefined
  } catch {
    return undefined
  }
}

/**
 * Convert DOMRect to plain object
 */
function rectToObject(rect: DOMRect): ElementInfo["rect"] {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
}

/**
 * Extract element info from a DOM element
 */
function extractElementInfo(
  element: Element,
  options: Required<ExtractorOptions>,
  depth: number = 0,
): ElementInfo | null {
  // Skip script, style, and invisible elements
  const tagName = element.tagName.toLowerCase()
  if (["script", "style", "noscript", "svg", "path", "meta", "link", "head"].includes(tagName)) {
    return null
  }

  // Skip hidden elements
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return null
  }

  const info: ElementInfo = {
    tagName,
    className: element.className || "",
    id: element.id || undefined,
    rect: rectToObject(rect),
    textContent: undefined,
    computedStyles: undefined,
    reactComponent: undefined,
    depth,
    children: undefined,
  }

  // Get direct text content (not from children)
  // Node.TEXT_NODE = 3
  const TEXT_NODE = 3
  const textContent = Array.from(element.childNodes)
    .filter((node) => node.nodeType === TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(" ")

  if (textContent) {
    info.textContent =
      textContent.length > options.maxTextLength
        ? textContent.slice(0, options.maxTextLength) + "..."
        : textContent
  }

  // Extract styles if enabled
  if (options.includeStyles) {
    info.computedStyles = extractStyles(element)
  }

  // Extract React info if enabled
  if (options.includeReact) {
    info.reactComponent = extractReactInfo(element) ?? undefined
  }

  // Extract children if within depth limit
  if (depth < options.maxDepth) {
    const children: ElementInfo[] = []
    for (const child of element.children) {
      const childInfo = extractElementInfo(child, options, depth + 1)
      if (childInfo) {
        children.push(childInfo)
      }
    }
    if (children.length > 0) {
      info.children = children
    }
  }

  return info
}

/**
 * Extract element tree starting from a selection
 */
export function extractElementTree(
  selection: Selection | null,
  options: ExtractorOptions = {},
): ElementInfo[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (!selection || selection.rangeCount === 0) {
    return []
  }

  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer

  // Find the element container
  let element: Element | null =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement

  if (!element) {
    return []
  }

  const info = extractElementInfo(element, opts, 0)
  return info ? [info] : []
}

/**
 * Extract element tree from a specific element
 */
export function extractFromElement(
  element: Element,
  options: ExtractorOptions = {},
): ElementInfo | null {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return extractElementInfo(element, opts, 0)
}

/**
 * Extract elements within a bounding box
 */
export function extractFromRect(
  rect: { x: number; y: number; width: number; height: number },
  options: ExtractorOptions = {},
): ElementInfo[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const elements: ElementInfo[] = []

  // Get all elements at center point
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2

  const elementsAtPoint = document.elementsFromPoint(centerX, centerY)

  for (const element of elementsAtPoint) {
    const elementRect = element.getBoundingClientRect()

    // Check if element overlaps with selection rect
    const overlaps =
      elementRect.left < rect.x + rect.width &&
      elementRect.right > rect.x &&
      elementRect.top < rect.y + rect.height &&
      elementRect.bottom > rect.y

    if (overlaps) {
      const info = extractElementInfo(element, opts, 0)
      if (info) {
        elements.push(info)
      }
    }
  }

  return elements
}

/**
 * Detect if React is present on the page
 */
export function detectReact(): { hasReact: boolean; version?: string } {
  // Check for React DevTools hook
  const hook = (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | { renderers?: Map<number, { version?: string }> }
    | undefined

  if (hook?.renderers) {
    for (const renderer of hook.renderers.values()) {
      if (renderer.version) {
        return { hasReact: true, version: renderer.version }
      }
    }
    return { hasReact: true }
  }

  // Guard against non-browser environment
  if (typeof document === "undefined" || !document.body) {
    return { hasReact: false }
  }

  // Check for React fiber keys on document
  const bodyKeys = Object.keys(document.body)
  const hasFiber = bodyKeys.some(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  )

  if (hasFiber) {
    return { hasReact: true }
  }

  // Check for React root
  const reactRoot = document.querySelector?.("[data-reactroot]") || document.getElementById?.("root")
  if (reactRoot) {
    const rootKeys = Object.keys(reactRoot)
    if (rootKeys.some((k) => k.startsWith("__reactContainer$"))) {
      return { hasReact: true }
    }
  }

  return { hasReact: false }
}

/**
 * Get the full page tree (limited depth)
 */
export function extractPageTree(options: ExtractorOptions = {}): ElementInfo | null {
  const opts = { ...DEFAULT_OPTIONS, ...options, maxDepth: Math.min(options.maxDepth ?? 5, 5) }
  return extractElementInfo(document.body, opts, 0)
}
