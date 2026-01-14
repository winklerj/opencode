import { z } from "zod"

/**
 * Types for the Chrome Extension Client.
 *
 * This client handles:
 * - DOM/React tree extraction for visual context
 * - Element selection overlay for targeting changes
 * - Sidebar chat interface via Chrome Side Panel API
 * - Direct session creation from browser context
 */

/**
 * Base element info schema (without recursive children)
 */
const ElementInfoBase = z.object({
  /** HTML tag name */
  tagName: z.string(),
  /** Element class name */
  className: z.string(),
  /** Element ID if present */
  id: z.string().optional(),
  /** Bounding rectangle */
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }),
  /** Truncated text content */
  textContent: z.string().optional(),
  /** Computed CSS styles (relevant subset) */
  computedStyles: z
    .object({
      display: z.string().optional(),
      position: z.string().optional(),
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      fontSize: z.string().optional(),
      fontWeight: z.string().optional(),
      padding: z.string().optional(),
      margin: z.string().optional(),
      border: z.string().optional(),
      borderRadius: z.string().optional(),
      flexDirection: z.string().optional(),
      justifyContent: z.string().optional(),
      alignItems: z.string().optional(),
      gap: z.string().optional(),
    })
    .optional(),
  /** React component information if available */
  reactComponent: z
    .object({
      /** Component name */
      name: z.string(),
      /** Component props */
      props: z.record(z.string(), z.unknown()),
      /** Component state if accessible */
      state: z.record(z.string(), z.unknown()).optional(),
      /** Debug source location */
      source: z
        .object({
          fileName: z.string(),
          lineNumber: z.number(),
          columnNumber: z.number().optional(),
        })
        .optional(),
      /** Owner component name */
      owner: z.string().optional(),
    })
    .optional(),
  /** Depth in the tree */
  depth: z.number().default(0),
})

/**
 * Information about a DOM element extracted from the page
 */
export type ElementInfo = z.infer<typeof ElementInfoBase> & {
  /** Child elements */
  children?: ElementInfo[]
}

export const ElementInfo: z.ZodType<ElementInfo> = ElementInfoBase.extend({
  children: z.lazy(() => z.array(ElementInfo)).optional(),
})

/**
 * Selection result from the overlay
 */
export const SelectionResult = z.object({
  /** Selected elements as a tree */
  elements: z.array(ElementInfo),
  /** Page URL */
  pageUrl: z.string(),
  /** Page title */
  pageTitle: z.string(),
  /** Timestamp of selection */
  timestamp: z.number(),
  /** Whether React was detected on the page */
  hasReact: z.boolean(),
  /** React version if detected */
  reactVersion: z.string().optional(),
})
export type SelectionResult = z.infer<typeof SelectionResult>

/**
 * Configuration for the Chrome extension
 */
export const ExtensionConfig = z.object({
  /** OpenCode API base URL */
  apiBaseUrl: z.string(),
  /** Authentication token */
  authToken: z.string().optional(),
  /** Enable debug logging */
  debug: z.boolean().default(false),
  /** Maximum tree depth to extract */
  maxTreeDepth: z.number().default(10),
  /** Maximum text content length per element */
  maxTextLength: z.number().default(100),
  /** Allowed domains for the extension */
  allowedDomains: z.array(z.string()).optional(),
})
export type ExtensionConfig = z.input<typeof ExtensionConfig>

/**
 * Message types between content script and sidebar
 */
export const ExtensionMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selection.start"),
  }),
  z.object({
    type: z.literal("selection.complete"),
    result: SelectionResult,
  }),
  z.object({
    type: z.literal("selection.cancel"),
  }),
  z.object({
    type: z.literal("selection.hover"),
    element: ElementInfo,
  }),
  z.object({
    type: z.literal("session.create"),
    prompt: z.string(),
    selection: SelectionResult.optional(),
  }),
  z.object({
    type: z.literal("session.status"),
    sessionID: z.string(),
    status: z.enum(["idle", "thinking", "executing"]),
  }),
  z.object({
    type: z.literal("config.update"),
    config: ExtensionConfig.partial(),
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
])
export type ExtensionMessage = z.infer<typeof ExtensionMessage>

/**
 * Events emitted by the Chrome extension
 */
export type ExtensionEvent =
  | { type: "selection.started" }
  | { type: "selection.completed"; result: SelectionResult }
  | { type: "selection.cancelled" }
  | { type: "session.created"; sessionID: string }
  | { type: "session.updated"; sessionID: string; status: string }
  | { type: "error"; message: string }

/**
 * Session context for the current browser tab
 */
export const TabSession = z.object({
  /** Tab ID */
  tabId: z.number(),
  /** OpenCode session ID */
  sessionID: z.string().optional(),
  /** Current selection */
  selection: SelectionResult.optional(),
  /** Last update timestamp */
  lastUpdate: z.number(),
})
export type TabSession = z.infer<typeof TabSession>
