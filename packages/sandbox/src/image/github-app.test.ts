import { describe, test, expect, mock, afterEach } from "bun:test"
import { generateKeyPairSync } from "crypto"
import {
  generateJWT,
  getInstallationToken,
  verifyRepositoryAccess,
  listAccessibleRepositories,
  GitHubAppClient,
  GitHubAppError,
} from "./github-app"

// Generate a real test RSA private key for testing JWT generation
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
})

const TEST_APP_ID = "123456"
const TEST_INSTALLATION_ID = "12345678"

// Save original fetch for restoration
const originalFetch = globalThis.fetch

// Helper to safely set mock fetch
function setMockFetch(mockFn: (...args: unknown[]) => Promise<unknown>): void {
  // @ts-expect-error - bun mock type issue with fetch.preconnect
  globalThis.fetch = mock(mockFn)
}

describe("GitHub App", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("generateJWT", () => {
    test("generates a valid JWT structure", () => {
      const jwt = generateJWT(TEST_APP_ID, TEST_PRIVATE_KEY)

      // JWT should have three parts separated by dots
      const parts = jwt.split(".")
      expect(parts).toHaveLength(3)

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString())
      expect(header.alg).toBe("RS256")
      expect(header.typ).toBe("JWT")

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
      expect(payload.iss).toBe(TEST_APP_ID)
      expect(payload.exp).toBeGreaterThan(payload.iat)
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(660) // Max 10 minutes + 60s buffer
    })

    test("handles escaped newlines in private key", () => {
      const escapedKey = TEST_PRIVATE_KEY.replace(/\n/g, "\\n")
      const jwt = generateJWT(TEST_APP_ID, escapedKey)

      const parts = jwt.split(".")
      expect(parts).toHaveLength(3)
    })
  })

  describe("getInstallationToken", () => {
    test("returns token on successful response", async () => {
      const mockResponse = {
        token: "ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        permissions: { contents: "read" },
        repository_selection: "all" as const,
      }

      setMockFetch(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      )

      const result = await getInstallationToken(TEST_APP_ID, TEST_PRIVATE_KEY, TEST_INSTALLATION_ID)

      expect(result.token).toBe(mockResponse.token)
      expect(result.expires_at).toBe(mockResponse.expires_at)
    })

    test("throws GitHubAppError on failure", async () => {
      setMockFetch(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: () => Promise.resolve("Bad credentials"),
        } as Response),
      )

      await expect(getInstallationToken(TEST_APP_ID, TEST_PRIVATE_KEY, TEST_INSTALLATION_ID)).rejects.toThrow(
        GitHubAppError,
      )
    })
  })

  describe("verifyRepositoryAccess", () => {
    test("returns true when app has access", async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          // Token request
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                token: "ghs_test",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }),
          } as Response)
        }
        // Repo access check
        return Promise.resolve({ ok: true } as Response)
      })

      const hasAccess = await verifyRepositoryAccess(
        { appId: TEST_APP_ID, privateKey: TEST_PRIVATE_KEY, installationId: TEST_INSTALLATION_ID },
        "org/repo",
      )

      expect(hasAccess).toBe(true)
    })

    test("returns false when app does not have access", async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                token: "ghs_test",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }),
          } as Response)
        }
        return Promise.resolve({ ok: false, status: 404 } as Response)
      })

      const hasAccess = await verifyRepositoryAccess(
        { appId: TEST_APP_ID, privateKey: TEST_PRIVATE_KEY, installationId: TEST_INSTALLATION_ID },
        "org/private-repo",
      )

      expect(hasAccess).toBe(false)
    })
  })

  describe("listAccessibleRepositories", () => {
    test("returns list of repositories", async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                token: "ghs_test",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              total_count: 2,
              repositories: [{ full_name: "org/repo1" }, { full_name: "org/repo2" }],
            }),
        } as Response)
      })

      const repos = await listAccessibleRepositories({
        appId: TEST_APP_ID,
        privateKey: TEST_PRIVATE_KEY,
        installationId: TEST_INSTALLATION_ID,
      })

      expect(repos).toEqual(["org/repo1", "org/repo2"])
    })

    test("handles pagination", async () => {
      let callCount = 0
      setMockFetch((url: unknown) => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                token: "ghs_test",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              }),
          } as Response)
        }

        // Parse page from URL
        const urlObj = new URL(url as string)
        const page = urlObj.searchParams.get("page") || "1"

        if (page === "1") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                total_count: 150,
                repositories: Array.from({ length: 100 }, (_, i) => ({ full_name: `org/repo${i + 1}` })),
              }),
          } as Response)
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              total_count: 150,
              repositories: Array.from({ length: 50 }, (_, i) => ({ full_name: `org/repo${i + 101}` })),
            }),
        } as Response)
      })

      const repos = await listAccessibleRepositories({
        appId: TEST_APP_ID,
        privateKey: TEST_PRIVATE_KEY,
        installationId: TEST_INSTALLATION_ID,
      })

      expect(repos).toHaveLength(150)
    })
  })

  describe("GitHubAppClient", () => {
    test("caches tokens and reuses them", async () => {
      let tokenRequestCount = 0
      setMockFetch(() => {
        tokenRequestCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: `ghs_token_${tokenRequestCount}`,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }),
        } as Response)
      })

      const client = new GitHubAppClient({
        appId: TEST_APP_ID,
        privateKey: TEST_PRIVATE_KEY,
        installationId: TEST_INSTALLATION_ID,
      })

      const token1 = await client.getToken()
      const token2 = await client.getToken()

      expect(token1).toBe(token2)
      expect(tokenRequestCount).toBe(1)
    })

    test("refreshes token when near expiry", async () => {
      let tokenRequestCount = 0
      setMockFetch(() => {
        tokenRequestCount++
        // First token expires in 1 minute (within buffer)
        const expiresAt =
          tokenRequestCount === 1
            ? new Date(Date.now() + 60000) // 1 minute
            : new Date(Date.now() + 3600000) // 1 hour

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: `ghs_token_${tokenRequestCount}`,
              expires_at: expiresAt.toISOString(),
            }),
        } as Response)
      })

      const client = new GitHubAppClient({
        appId: TEST_APP_ID,
        privateKey: TEST_PRIVATE_KEY,
        installationId: TEST_INSTALLATION_ID,
      })

      await client.getToken()
      await client.getToken() // Should trigger refresh due to buffer

      expect(tokenRequestCount).toBe(2)
    })

    test("clearCache forces new token fetch", async () => {
      let tokenRequestCount = 0
      setMockFetch(() => {
        tokenRequestCount++
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              token: `ghs_token_${tokenRequestCount}`,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }),
        } as Response)
      })

      const client = new GitHubAppClient({
        appId: TEST_APP_ID,
        privateKey: TEST_PRIVATE_KEY,
        installationId: TEST_INSTALLATION_ID,
      })

      await client.getToken()
      client.clearCache()
      await client.getToken()

      expect(tokenRequestCount).toBe(2)
    })
  })

  describe("GitHubAppError", () => {
    test("includes status code and response", () => {
      const error = new GitHubAppError("Test error", 401, { message: "Unauthorized" })

      expect(error.message).toBe("Test error")
      expect(error.statusCode).toBe(401)
      expect(error.response).toEqual({ message: "Unauthorized" })
      expect(error.name).toBe("GitHubAppError")
    })
  })
})
