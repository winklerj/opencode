import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { extractFromElement, detectReact, extractPageTree, extractFromRect } from "./dom-extractor"

// Mock DOM environment
const createMockElement = (options: {
  tagName: string
  id?: string
  className?: string
  textContent?: string
  rect?: Partial<DOMRect>
  children?: Element[]
  styles?: Record<string, string>
}) => {
  const element = {
    tagName: options.tagName.toUpperCase(),
    id: options.id ?? "",
    className: options.className ?? "",
    childNodes: options.textContent
      ? [{ nodeType: 3, textContent: options.textContent }]
      : [],
    children: options.children ?? [],
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      top: 0,
      right: 100,
      bottom: 50,
      left: 0,
      ...options.rect,
      toJSON: () => ({}),
    }),
  } as unknown as Element

  return element
}

// Mock globalThis for browser APIs
const originalGetComputedStyle = globalThis.getComputedStyle

beforeEach(() => {
  // Mock getComputedStyle
  const mockGetComputedStyle = mock(
    (_element: Element) => ({
      getPropertyValue: (prop: string) => {
        const defaults: Record<string, string> = {
          display: "block",
          position: "static",
          color: "rgb(0, 0, 0)",
          "background-color": "rgba(0, 0, 0, 0)",
          "font-size": "16px",
          "font-weight": "400",
          padding: "0px",
          margin: "0px",
          border: "none",
          "border-radius": "0px",
          "flex-direction": "row",
          "justify-content": "normal",
          "align-items": "normal",
          gap: "0px",
        }
        return defaults[prop] ?? ""
      },
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).getComputedStyle = mockGetComputedStyle
})

afterEach(() => {
  globalThis.getComputedStyle = originalGetComputedStyle
})

describe("extractFromElement", () => {
  test("extracts basic element info", () => {
    const element = createMockElement({
      tagName: "div",
      id: "test-id",
      className: "test-class",
      textContent: "Hello World",
    })

    const result = extractFromElement(element)

    expect(result).not.toBeNull()
    expect(result?.tagName).toBe("div")
    expect(result?.id).toBe("test-id")
    expect(result?.className).toBe("test-class")
    expect(result?.textContent).toBe("Hello World")
    expect(result?.depth).toBe(0)
  })

  test("extracts bounding rect", () => {
    const element = createMockElement({
      tagName: "button",
      rect: { x: 10, y: 20, width: 200, height: 40 },
    })

    const result = extractFromElement(element)

    expect(result?.rect.x).toBe(10)
    expect(result?.rect.y).toBe(20)
    expect(result?.rect.width).toBe(200)
    expect(result?.rect.height).toBe(40)
  })

  test("truncates long text content", () => {
    const longText = "A".repeat(200)
    const element = createMockElement({
      tagName: "p",
      textContent: longText,
    })

    const result = extractFromElement(element, { maxTextLength: 50 })

    expect(result?.textContent?.length).toBeLessThanOrEqual(53) // 50 + "..."
    expect(result?.textContent?.endsWith("...")).toBe(true)
  })

  test("excludes script elements", () => {
    const element = createMockElement({ tagName: "script" })

    const result = extractFromElement(element)

    expect(result).toBeNull()
  })

  test("excludes style elements", () => {
    const element = createMockElement({ tagName: "style" })

    const result = extractFromElement(element)

    expect(result).toBeNull()
  })

  test("excludes zero-size elements", () => {
    const element = createMockElement({
      tagName: "div",
      rect: { width: 0, height: 0 },
    })

    const result = extractFromElement(element)

    expect(result).toBeNull()
  })

  test("respects maxDepth option", () => {
    const grandchild = createMockElement({ tagName: "span", textContent: "grandchild" })
    const child = createMockElement({ tagName: "p", children: [grandchild] })
    const parent = createMockElement({ tagName: "div", children: [child] })

    const resultDepth0 = extractFromElement(parent, { maxDepth: 0 })
    expect(resultDepth0?.children).toBeUndefined()

    const resultDepth1 = extractFromElement(parent, { maxDepth: 1 })
    expect(resultDepth1?.children?.length).toBe(1)
    expect(resultDepth1?.children?.[0]?.children).toBeUndefined()
  })

  test("extracts computed styles when enabled", () => {
    const element = createMockElement({ tagName: "div" })

    const resultWithStyles = extractFromElement(element, { includeStyles: true })
    expect(resultWithStyles?.computedStyles).toBeDefined()

    const resultWithoutStyles = extractFromElement(element, { includeStyles: false })
    expect(resultWithoutStyles?.computedStyles).toBeUndefined()
  })

  test("handles elements without id", () => {
    const element = createMockElement({ tagName: "div", className: "only-class" })

    const result = extractFromElement(element)

    expect(result?.id).toBeUndefined()
    expect(result?.className).toBe("only-class")
  })
})

describe("detectReact", () => {
  test("returns false when React is not present", () => {
    // Ensure no React globals
    delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__

    const result = detectReact()

    expect(result.hasReact).toBe(false)
    expect(result.version).toBeUndefined()
  })

  test("detects React via DevTools hook", () => {
    // Mock React DevTools hook
    const mockHook = {
      renderers: new Map([
        [1, { version: "18.2.0" }],
      ]),
    }
    ;(globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = mockHook

    const result = detectReact()

    expect(result.hasReact).toBe(true)
    expect(result.version).toBe("18.2.0")

    // Cleanup
    delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__
  })

  test("detects React without version when no renderer version available", () => {
    // Mock React DevTools hook without version
    const mockHook = {
      renderers: new Map([
        [1, {}],
      ]),
    }
    ;(globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = mockHook

    const result = detectReact()

    expect(result.hasReact).toBe(true)
    expect(result.version).toBeUndefined()

    // Cleanup
    delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__
  })
})

describe("extractPageTree", () => {
  test("limits depth for page tree extraction", () => {
    // Mock document.body
    const originalBody = globalThis.document?.body
    const mockBody = createMockElement({
      tagName: "body",
      children: [
        createMockElement({
          tagName: "div",
          children: [createMockElement({ tagName: "span" })],
        }),
      ],
    })

    Object.defineProperty(globalThis, "document", {
      value: { body: mockBody },
      writable: true,
      configurable: true,
    })

    const result = extractPageTree({ maxDepth: 1 })

    expect(result?.tagName).toBe("body")
    expect(result?.children?.length).toBe(1)
    expect(result?.children?.[0]?.children).toBeUndefined()

    // Cleanup
    if (originalBody !== undefined) {
      Object.defineProperty(globalThis, "document", {
        value: { body: originalBody },
        writable: true,
        configurable: true,
      })
    }
  })
})

describe("extractFromRect", () => {
  test("finds elements within bounding box", () => {
    const mockElement = createMockElement({
      tagName: "button",
      textContent: "Click me",
      rect: { x: 50, y: 50, width: 100, height: 40, left: 50, right: 150, top: 50, bottom: 90 },
    })

    // Mock document.elementsFromPoint
    Object.defineProperty(globalThis, "document", {
      value: {
        elementsFromPoint: () => [mockElement],
      },
      writable: true,
      configurable: true,
    })

    const result = extractFromRect({ x: 40, y: 40, width: 120, height: 60 })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0]?.tagName).toBe("button")
  })
})
