import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { SelectionOverlay, createSelectionOverlay } from "./selection-overlay"

// Mock DOM environment
let mockDocument: {
  createElement: (tag: string) => HTMLElement
  body: HTMLElement
  addEventListener: ReturnType<typeof mock>
  removeEventListener: ReturnType<typeof mock>
  elementFromPoint: ReturnType<typeof mock>
}

let mockWindow: {
  location: { href: string }
  getComputedStyle: ReturnType<typeof mock>
}

beforeEach(() => {
  // Create mock elements
  const createMockHTMLElement = () => ({
    id: "",
    style: {
      cssText: "",
      left: "",
      top: "",
      width: "",
      height: "",
      display: "",
    },
    appendChild: mock(() => {}),
    remove: mock(() => {}),
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    contains: mock(() => false),
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      top: 0,
      right: 100,
      bottom: 50,
      left: 0,
      toJSON: () => ({}),
    }),
    textContent: "",
  })

  const mockBody = {
    ...createMockHTMLElement(),
    appendChild: mock(() => {}),
  }

  mockDocument = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createElement: mock((tag: string) => ({
      ...createMockHTMLElement(),
      tagName: tag.toUpperCase(),
    })) as any,
    body: mockBody as unknown as HTMLElement,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    elementFromPoint: mock(() => null),
  }

  mockWindow = {
    location: { href: "https://example.com" },
    getComputedStyle: mock(() => ({
      getPropertyValue: () => "",
    })),
  }

  // Set up global mocks
  ;(globalThis as Record<string, unknown>).document = mockDocument
  ;(globalThis as Record<string, unknown>).window = mockWindow
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document
  delete (globalThis as Record<string, unknown>).window
})

describe("SelectionOverlay", () => {
  describe("constructor", () => {
    test("creates overlay with default styles", () => {
      const overlay = new SelectionOverlay()
      expect(overlay.active).toBe(false)
    })

    test("creates overlay with custom styles", () => {
      const overlay = new SelectionOverlay({
        highlightColor: "rgba(255, 0, 0, 0.5)",
        highlightBorderWidth: 3,
      })
      expect(overlay.active).toBe(false)
    })
  })

  describe("start", () => {
    test("activates selection mode", () => {
      const overlay = new SelectionOverlay()

      overlay.start()

      expect(overlay.active).toBe(true)
      expect(mockDocument.body.appendChild).toHaveBeenCalled()
      expect(mockDocument.addEventListener).toHaveBeenCalled()
    })

    test("does not start twice", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      const callCount = (mockDocument.body.appendChild as ReturnType<typeof mock>).mock.calls.length
      overlay.start()

      expect((mockDocument.body.appendChild as ReturnType<typeof mock>).mock.calls.length).toBe(callCount)
    })

    test("accepts callbacks", () => {
      const overlay = new SelectionOverlay()
      const onHover = mock(() => {})
      const onSelect = mock(() => {})

      overlay.start({ onHover, onSelect })

      expect(overlay.active).toBe(true)
    })
  })

  describe("stop", () => {
    test("deactivates selection mode", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      overlay.stop()

      expect(overlay.active).toBe(false)
      expect(mockDocument.removeEventListener).toHaveBeenCalled()
    })

    test("does nothing if not active", () => {
      const overlay = new SelectionOverlay()

      overlay.stop()

      expect(overlay.active).toBe(false)
    })

    test("clears selection", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      expect(overlay.getSelectedElements().length).toBe(0)
      overlay.stop()

      expect(overlay.getSelectedElements().length).toBe(0)
    })
  })

  describe("complete", () => {
    test("returns null if not active", () => {
      const overlay = new SelectionOverlay()

      const result = overlay.complete()

      expect(result).toBeNull()
    })

    test("calls onComplete callback", () => {
      const overlay = new SelectionOverlay()
      const onComplete = mock(() => {})

      overlay.start({ onComplete })
      const result = overlay.complete()

      expect(result).not.toBeNull()
      expect(result?.elements).toEqual([])
      expect(result?.pageUrl).toBe("https://example.com")
      expect(result?.timestamp).toBeDefined()
      expect(onComplete).toHaveBeenCalled()
    })

    test("stops overlay after complete", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      overlay.complete()

      expect(overlay.active).toBe(false)
    })
  })

  describe("cancel", () => {
    test("calls onCancel callback", () => {
      const overlay = new SelectionOverlay()
      const onCancel = mock(() => {})

      overlay.start({ onCancel })
      overlay.cancel()

      expect(onCancel).toHaveBeenCalled()
      expect(overlay.active).toBe(false)
    })
  })

  describe("getSelectedElements", () => {
    test("returns empty array initially", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      const elements = overlay.getSelectedElements()

      expect(elements).toEqual([])
      overlay.stop()
    })
  })

  describe("clearSelection", () => {
    test("clears all selected elements", () => {
      const overlay = new SelectionOverlay()

      overlay.start()
      overlay.clearSelection()

      expect(overlay.getSelectedElements().length).toBe(0)
      overlay.stop()
    })
  })
})

describe("createSelectionOverlay", () => {
  test("creates overlay with default styles", () => {
    const overlay = createSelectionOverlay()

    expect(overlay).toBeInstanceOf(SelectionOverlay)
    expect(overlay.active).toBe(false)
  })

  test("creates overlay with custom styles", () => {
    const overlay = createSelectionOverlay({
      highlightColor: "rgba(0, 255, 0, 0.5)",
    })

    expect(overlay).toBeInstanceOf(SelectionOverlay)
  })
})
