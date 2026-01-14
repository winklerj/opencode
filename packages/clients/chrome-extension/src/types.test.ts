import { describe, test, expect } from "bun:test"
import {
  ElementInfo,
  SelectionResult,
  ExtensionConfig,
  ExtensionMessage,
  TabSession,
} from "./types"

describe("ElementInfo", () => {
  test("parses valid element info", () => {
    const data = {
      tagName: "div",
      className: "container",
      id: "main",
      rect: {
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        top: 0,
        right: 100,
        bottom: 50,
        left: 0,
      },
      textContent: "Hello",
      depth: 0,
    }

    const result = ElementInfo.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tagName).toBe("div")
      expect(result.data.className).toBe("container")
      expect(result.data.id).toBe("main")
    }
  })

  test("parses element info with React component", () => {
    const data = {
      tagName: "div",
      className: "",
      rect: { x: 0, y: 0, width: 100, height: 50, top: 0, right: 100, bottom: 50, left: 0 },
      depth: 0,
      reactComponent: {
        name: "Button",
        props: { variant: "primary", disabled: false },
        source: {
          fileName: "/src/components/Button.tsx",
          lineNumber: 42,
        },
        owner: "App",
      },
    }

    const result = ElementInfo.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reactComponent?.name).toBe("Button")
      expect(result.data.reactComponent?.props).toEqual({ variant: "primary", disabled: false })
      expect(result.data.reactComponent?.source?.fileName).toBe("/src/components/Button.tsx")
    }
  })

  test("parses element info with computed styles", () => {
    const data = {
      tagName: "button",
      className: "btn",
      rect: { x: 0, y: 0, width: 100, height: 50, top: 0, right: 100, bottom: 50, left: 0 },
      depth: 0,
      computedStyles: {
        display: "flex",
        backgroundColor: "rgb(59, 130, 246)",
        borderRadius: "8px",
      },
    }

    const result = ElementInfo.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.computedStyles?.display).toBe("flex")
      expect(result.data.computedStyles?.backgroundColor).toBe("rgb(59, 130, 246)")
    }
  })

  test("rejects missing required fields", () => {
    const data = {
      className: "container",
    }

    const result = ElementInfo.safeParse(data)

    expect(result.success).toBe(false)
  })
})

describe("SelectionResult", () => {
  test("parses valid selection result", () => {
    const data = {
      elements: [
        {
          tagName: "button",
          className: "submit-btn",
          rect: { x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0 },
          depth: 0,
        },
      ],
      pageUrl: "https://example.com/page",
      pageTitle: "Example Page",
      timestamp: Date.now(),
      hasReact: true,
      reactVersion: "18.2.0",
    }

    const result = SelectionResult.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.elements.length).toBe(1)
      expect(result.data.pageUrl).toBe("https://example.com/page")
      expect(result.data.hasReact).toBe(true)
      expect(result.data.reactVersion).toBe("18.2.0")
    }
  })

  test("parses selection result without React", () => {
    const data = {
      elements: [],
      pageUrl: "https://example.com",
      pageTitle: "Example",
      timestamp: Date.now(),
      hasReact: false,
    }

    const result = SelectionResult.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hasReact).toBe(false)
      expect(result.data.reactVersion).toBeUndefined()
    }
  })
})

describe("ExtensionConfig", () => {
  test("parses minimal config", () => {
    const data = {
      apiBaseUrl: "https://api.opencode.ai",
    }

    const result = ExtensionConfig.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.apiBaseUrl).toBe("https://api.opencode.ai")
      expect(result.data.debug).toBe(false)
      expect(result.data.maxTreeDepth).toBe(10)
      expect(result.data.maxTextLength).toBe(100)
    }
  })

  test("parses full config", () => {
    const data = {
      apiBaseUrl: "https://api.opencode.ai",
      authToken: "secret-token",
      debug: true,
      maxTreeDepth: 5,
      maxTextLength: 200,
      allowedDomains: ["example.com", "test.com"],
    }

    const result = ExtensionConfig.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.authToken).toBe("secret-token")
      expect(result.data.debug).toBe(true)
      expect(result.data.maxTreeDepth).toBe(5)
      expect(result.data.allowedDomains).toEqual(["example.com", "test.com"])
    }
  })

  test("rejects config without apiBaseUrl", () => {
    const data = {
      debug: true,
    }

    const result = ExtensionConfig.safeParse(data)

    expect(result.success).toBe(false)
  })
})

describe("ExtensionMessage", () => {
  test("parses selection.start message", () => {
    const data = { type: "selection.start" }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("selection.start")
    }
  })

  test("parses selection.complete message", () => {
    const data = {
      type: "selection.complete",
      result: {
        elements: [],
        pageUrl: "https://example.com",
        pageTitle: "Example",
        timestamp: Date.now(),
        hasReact: false,
      },
    }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success && result.data.type === "selection.complete") {
      expect(result.data.result.pageUrl).toBe("https://example.com")
    }
  })

  test("parses session.create message", () => {
    const data = {
      type: "session.create",
      prompt: "Fix the button styling",
    }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success && result.data.type === "session.create") {
      expect(result.data.prompt).toBe("Fix the button styling")
    }
  })

  test("parses session.status message", () => {
    const data = {
      type: "session.status",
      sessionID: "session-123",
      status: "running",
    }

    const result = ExtensionMessage.safeParse(data)

    // Note: status "running" is not in the enum, should fail
    expect(result.success).toBe(false)
  })

  test("parses valid session.status message", () => {
    const data = {
      type: "session.status",
      sessionID: "session-123",
      status: "thinking",
    }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(true)
  })

  test("parses error message", () => {
    const data = {
      type: "error",
      error: "Something went wrong",
    }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success && result.data.type === "error") {
      expect(result.data.error).toBe("Something went wrong")
    }
  })

  test("rejects unknown message type", () => {
    const data = {
      type: "unknown.type",
    }

    const result = ExtensionMessage.safeParse(data)

    expect(result.success).toBe(false)
  })
})

describe("TabSession", () => {
  test("parses minimal tab session", () => {
    const data = {
      tabId: 123,
      lastUpdate: Date.now(),
    }

    const result = TabSession.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tabId).toBe(123)
      expect(result.data.sessionID).toBeUndefined()
    }
  })

  test("parses full tab session", () => {
    const data = {
      tabId: 123,
      sessionID: "session-456",
      selection: {
        elements: [],
        pageUrl: "https://example.com",
        pageTitle: "Example",
        timestamp: Date.now(),
        hasReact: true,
        reactVersion: "18.2.0",
      },
      lastUpdate: Date.now(),
    }

    const result = TabSession.safeParse(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tabId).toBe(123)
      expect(result.data.sessionID).toBe("session-456")
      expect(result.data.selection?.hasReact).toBe(true)
    }
  })
})
