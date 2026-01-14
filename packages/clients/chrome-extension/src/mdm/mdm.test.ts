import { describe, expect, test } from "bun:test"
import {
  // Types
  type ChromeEnterprisePolicy,
  type MDMPolicyConfig,
  type UpdateManifest,
  type UpdateManifestEntry,
  type UpdateServerConfig,
  type CRXPackageConfig,
  InstallationMode,
  MDMProvider,

  // Update manifest
  generateUpdateManifestXML,
  createUpdateManifest,
  createUpdateManifestEntry,
  parseUpdateManifestXML,
  validateUpdateManifest,

  // Policy templates
  generateChromeEnterprisePolicy,
  generateMDMPolicyTemplate,
  getSupportedMDMProviders,
  getMDMProviderDisplayName,
  validateMDMPolicyConfig,

  // Update server
  createUpdateServerHandlers,
  validateUpdateServerConfig,
  generateNginxConfig,
  generateCloudflareWorkerScript,

  // CRX packager
  calculateExtensionId,
  exportPrivateKeyToPEM,
  importPrivateKeyFromPEM,
  generateKeyPair,
} from "./index"

describe("MDM Types", () => {
  test("InstallationMode enum has expected values", () => {
    expect(InstallationMode.enum).toEqual({
      allowed: "allowed",
      blocked: "blocked",
      force_installed: "force_installed",
      normal_installed: "normal_installed",
      removed: "removed",
    })
  })

  test("MDMProvider enum has expected values", () => {
    expect(MDMProvider.enum).toEqual({
      jamf: "jamf",
      intune: "intune",
      workspace_one: "workspace_one",
      kandji: "kandji",
      mosyle: "mosyle",
      google_admin: "google_admin",
      generic: "generic",
    })
  })
})

describe("Update Manifest", () => {
  const testExtensionId = "abcdefghijklmnopabcdefghijklmnop"
  const testVersion = "1.0.0"
  const testBaseUrl = "https://updates.example.com"

  test("createUpdateManifestEntry creates valid entry", () => {
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
    })

    expect(entry.appId).toBe(testExtensionId)
    expect(entry.version).toBe(testVersion)
    expect(entry.codebase).toBe(`${testBaseUrl}/opencode-extension-${testVersion}.crx`)
  })

  test("createUpdateManifestEntry with custom filename", () => {
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
      filename: "custom-extension.crx",
    })

    expect(entry.codebase).toBe(`${testBaseUrl}/custom-extension.crx`)
  })

  test("createUpdateManifestEntry with hash and size", () => {
    const hash = "a".repeat(64)
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
      hash,
      size: 12345,
    })

    expect(entry.hash).toBe(hash)
    expect(entry.hashAlgorithm).toBe("sha256")
    expect(entry.size).toBe(12345)
  })

  test("createUpdateManifest creates valid manifest", () => {
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
    })

    const manifest = createUpdateManifest(entry)

    expect(manifest.protocol).toBe("2.0")
    expect(manifest.apps).toHaveLength(1)
    expect(manifest.apps[0]).toEqual(entry)
  })

  test("generateUpdateManifestXML produces valid XML", () => {
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
    })

    const manifest = createUpdateManifest(entry)
    const xml = generateUpdateManifestXML(manifest)

    expect(xml).toContain("<?xml version='1.0' encoding='UTF-8'?>")
    expect(xml).toContain("<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>")
    expect(xml).toContain(`appid='${testExtensionId}'`)
    expect(xml).toContain(`version='${testVersion}'`)
    expect(xml).toContain("</gupdate>")
  })

  test("generateUpdateManifestXML includes hash when provided", () => {
    const hash = "a".repeat(64)
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
      hash,
    })

    const manifest = createUpdateManifest(entry)
    const xml = generateUpdateManifestXML(manifest)

    expect(xml).toContain(`hash='${hash}'`)
    expect(xml).toContain(`hash_sha256='${hash}'`)
  })

  test("parseUpdateManifestXML parses valid XML", () => {
    const originalEntry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
    })

    const manifest = createUpdateManifest(originalEntry)
    const xml = generateUpdateManifestXML(manifest)
    const parsed = parseUpdateManifestXML(xml)

    expect(parsed.protocol).toBe("2.0")
    expect(parsed.apps).toHaveLength(1)
    expect(parsed.apps[0]!.appId).toBe(testExtensionId)
    expect(parsed.apps[0]!.version).toBe(testVersion)
  })

  test("parseUpdateManifestXML handles multiple apps", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='aaaabbbbccccddddaaaabbbbccccdddd'>
    <updatecheck codebase='https://example.com/ext1.crx' version='1.0.0' />
  </app>
  <app appid='eeeeffff0000111122223333444455556'>
    <updatecheck codebase='https://example.com/ext2.crx' version='2.0.0' />
  </app>
</gupdate>`

    const parsed = parseUpdateManifestXML(xml)

    expect(parsed.apps).toHaveLength(2)
    expect(parsed.apps[0]!.version).toBe("1.0.0")
    expect(parsed.apps[1]!.version).toBe("2.0.0")
  })

  test("validateUpdateManifest accepts valid manifest", () => {
    const entry = createUpdateManifestEntry({
      extensionId: testExtensionId,
      version: testVersion,
      baseUrl: testBaseUrl,
    })

    const manifest = createUpdateManifest(entry)
    const result = validateUpdateManifest(manifest)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("validateUpdateManifest rejects invalid extension ID", () => {
    const manifest: UpdateManifest = {
      protocol: "2.0",
      apps: [
        {
          appId: "invalid",
          version: "1.0.0",
          codebase: "https://example.com/ext.crx",
        },
      ],
    }

    const result = validateUpdateManifest(manifest)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("Invalid extension ID"))).toBe(true)
  })

  test("validateUpdateManifest rejects invalid version", () => {
    const manifest: UpdateManifest = {
      protocol: "2.0",
      apps: [
        {
          appId: testExtensionId,
          version: "invalid-version",
          codebase: "https://example.com/ext.crx",
        },
      ],
    }

    const result = validateUpdateManifest(manifest)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("Invalid version"))).toBe(true)
  })

  test("validateUpdateManifest rejects empty apps array", () => {
    const manifest: UpdateManifest = {
      protocol: "2.0",
      apps: [],
    }

    const result = validateUpdateManifest(manifest)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("at least one app"))).toBe(true)
  })
})

describe("MDM Policy Templates", () => {
  const testConfig: MDMPolicyConfig = {
    provider: "generic",
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    updateUrl: "https://updates.example.com/extension.xml",
    forceInstall: true,
    pinToToolbar: true,
  }

  test("generateChromeEnterprisePolicy creates valid policy", () => {
    const policy = generateChromeEnterprisePolicy(testConfig)

    expect(policy.ExtensionInstallForcelist).toBeDefined()
    expect(policy.ExtensionInstallForcelist?.[0]).toBe(`${testConfig.extensionId};${testConfig.updateUrl}`)
    expect(policy.ExtensionSettings).toBeDefined()
    expect(policy.ExtensionSettings?.[testConfig.extensionId]).toBeDefined()
    expect(policy.ExtensionSettings?.[testConfig.extensionId]?.installation_mode).toBe("force_installed")
    expect(policy.ExtensionSettings?.[testConfig.extensionId]?.toolbar_state).toBe("force_pinned")
  })

  test("generateChromeEnterprisePolicy with forceInstall=false", () => {
    const config = { ...testConfig, forceInstall: false }
    const policy = generateChromeEnterprisePolicy(config)

    expect(policy.ExtensionInstallForcelist).toBeUndefined()
    expect(policy.ExtensionSettings?.[config.extensionId]?.installation_mode).toBe("allowed")
  })

  test("generateChromeEnterprisePolicy includes minimum version", () => {
    const config = { ...testConfig, minimumVersion: "1.0.0" }
    const policy = generateChromeEnterprisePolicy(config)

    expect(policy.ExtensionSettings?.[config.extensionId]?.minimum_version_required).toBe("1.0.0")
  })

  test("getSupportedMDMProviders returns all providers", () => {
    const providers = getSupportedMDMProviders()

    expect(providers).toContain("jamf")
    expect(providers).toContain("intune")
    expect(providers).toContain("workspace_one")
    expect(providers).toContain("kandji")
    expect(providers).toContain("mosyle")
    expect(providers).toContain("google_admin")
    expect(providers).toContain("generic")
    expect(providers).toHaveLength(7)
  })

  test("getMDMProviderDisplayName returns correct names", () => {
    expect(getMDMProviderDisplayName("jamf")).toBe("Jamf Pro")
    expect(getMDMProviderDisplayName("intune")).toBe("Microsoft Intune")
    expect(getMDMProviderDisplayName("workspace_one")).toBe("VMware Workspace ONE")
    expect(getMDMProviderDisplayName("kandji")).toBe("Kandji")
    expect(getMDMProviderDisplayName("mosyle")).toBe("Mosyle")
    expect(getMDMProviderDisplayName("google_admin")).toBe("Google Admin Console")
    expect(getMDMProviderDisplayName("generic")).toBe("Generic JSON")
  })

  test("generateMDMPolicyTemplate generates Jamf plist", () => {
    const config = { ...testConfig, provider: "jamf" as const }
    const template = generateMDMPolicyTemplate(config)

    expect(template).toContain("<!DOCTYPE plist")
    expect(template).toContain("com.google.Chrome")
    expect(template).toContain("ExtensionInstallForcelist")
    expect(template).toContain(testConfig.extensionId)
  })

  test("generateMDMPolicyTemplate generates Intune OMA-URI", () => {
    const config = { ...testConfig, provider: "intune" as const }
    const template = generateMDMPolicyTemplate(config)

    const parsed = JSON.parse(template)
    expect(parsed.omaSettings).toBeDefined()
    expect(parsed.omaSettings[0].omaUri).toContain("MSFT/Policy")
  })

  test("generateMDMPolicyTemplate generates Google Admin JSON", () => {
    const config = { ...testConfig, provider: "google_admin" as const }
    const template = generateMDMPolicyTemplate(config)

    const parsed = JSON.parse(template)
    expect(parsed.policyType).toBe("CHROME_BROWSER")
    expect(parsed.policy.ExtensionInstallForcelist).toBeDefined()
  })

  test("generateMDMPolicyTemplate generates generic JSON", () => {
    const template = generateMDMPolicyTemplate(testConfig)

    const parsed = JSON.parse(template)
    expect(parsed.extensionId).toBe(testConfig.extensionId)
    expect(parsed.chromePolicy).toBeDefined()
    expect(parsed.instructions).toBeDefined()
  })

  test("validateMDMPolicyConfig accepts valid config", () => {
    const result = validateMDMPolicyConfig(testConfig)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("validateMDMPolicyConfig rejects invalid extension ID length", () => {
    const config = { ...testConfig, extensionId: "tooshort" }
    const result = validateMDMPolicyConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("32 lowercase"))).toBe(true)
  })

  test("validateMDMPolicyConfig rejects invalid extension ID characters", () => {
    const config = { ...testConfig, extensionId: "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP" }
    const result = validateMDMPolicyConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("lowercase letters"))).toBe(true)
  })

  test("validateMDMPolicyConfig rejects invalid URL", () => {
    const config = { ...testConfig, updateUrl: "not-a-url" }
    const result = validateMDMPolicyConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("valid URL"))).toBe(true)
  })

  test("validateMDMPolicyConfig rejects invalid version format", () => {
    const config = { ...testConfig, minimumVersion: "v1.0" }
    const result = validateMDMPolicyConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("format X.Y.Z"))).toBe(true)
  })
})

describe("Update Server", () => {
  const testConfig: UpdateServerConfig = {
    baseUrl: "https://updates.example.com",
    crxDirectory: "./releases",
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    currentVersion: "1.0.0",
    enableCors: true,
    cacheMaxAge: 3600,
  }

  test("createUpdateServerHandlers returns all handlers", () => {
    const handlers = createUpdateServerHandlers(testConfig)

    expect(handlers.handleManifestRequest).toBeDefined()
    expect(handlers.handleCRXRequest).toBeDefined()
    expect(handlers.handleVersionRequest).toBeDefined()
  })

  test("handleManifestRequest returns XML response", async () => {
    const handlers = createUpdateServerHandlers(testConfig)
    const request = new Request("https://updates.example.com/extension.xml")

    const response = await handlers.handleManifestRequest(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("application/xml")
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")

    const body = await response.text()
    expect(body).toContain("<?xml")
    expect(body).toContain(testConfig.extensionId)
    expect(body).toContain(testConfig.currentVersion)
  })

  test("handleVersionRequest returns JSON response", async () => {
    const handlers = createUpdateServerHandlers(testConfig)
    const request = new Request("https://updates.example.com/latest.json")

    const response = await handlers.handleVersionRequest(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")

    const body = await response.json()
    expect(body.extensionId).toBe(testConfig.extensionId)
    expect(body.currentVersion).toBe(testConfig.currentVersion)
    expect(body.updateUrl).toContain("extension.xml")
    expect(body.downloadUrl).toContain(".crx")
  })

  test("validateUpdateServerConfig accepts valid config", () => {
    const result = validateUpdateServerConfig(testConfig)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("validateUpdateServerConfig rejects invalid URL", () => {
    const config = { ...testConfig, baseUrl: "not-a-url" }
    const result = validateUpdateServerConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("valid URL"))).toBe(true)
  })

  test("validateUpdateServerConfig rejects missing crxDirectory", () => {
    const config = { ...testConfig, crxDirectory: "" }
    const result = validateUpdateServerConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("CRX directory"))).toBe(true)
  })

  test("validateUpdateServerConfig rejects negative cacheMaxAge", () => {
    const config = { ...testConfig, cacheMaxAge: -1 }
    const result = validateUpdateServerConfig(config)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("non-negative"))).toBe(true)
  })

  test("generateNginxConfig produces valid nginx configuration", () => {
    const nginx = generateNginxConfig(testConfig)

    expect(nginx).toContain("location")
    expect(nginx).toContain(".crx")
    expect(nginx).toContain("application/x-chrome-extension")
    expect(nginx).toContain("extension.xml")
    expect(nginx).toContain("application/xml")
  })

  test("generateCloudflareWorkerScript produces valid Worker script", () => {
    const script = generateCloudflareWorkerScript(testConfig)

    expect(script).toContain("export default")
    expect(script).toContain("async fetch")
    expect(script).toContain("/extension.xml")
    expect(script).toContain(testConfig.extensionId)
    expect(script).toContain(testConfig.currentVersion)
  })
})

describe("CRX Packager", () => {
  test("calculateExtensionId produces 32-character ID", async () => {
    const { publicKey } = await generateKeyPair()
    const extensionId = calculateExtensionId(publicKey)

    expect(extensionId).toHaveLength(32)
    expect(/^[a-p]+$/.test(extensionId)).toBe(true)
  })

  test("calculateExtensionId is deterministic", async () => {
    const { publicKey } = await generateKeyPair()
    const id1 = calculateExtensionId(publicKey)
    const id2 = calculateExtensionId(publicKey)

    expect(id1).toBe(id2)
  })

  test("generateKeyPair produces valid keys", async () => {
    const { publicKey, privateKey } = await generateKeyPair()

    expect(publicKey.length).toBeGreaterThan(0)
    expect(privateKey.length).toBeGreaterThan(0)
  })

  test("exportPrivateKeyToPEM produces valid PEM", async () => {
    const { privateKey } = await generateKeyPair()
    const pem = exportPrivateKeyToPEM(privateKey)

    expect(pem).toContain("-----BEGIN PRIVATE KEY-----")
    expect(pem).toContain("-----END PRIVATE KEY-----")
  })

  test("importPrivateKeyFromPEM reverses export", async () => {
    const { privateKey } = await generateKeyPair()
    const pem = exportPrivateKeyToPEM(privateKey)
    const imported = importPrivateKeyFromPEM(pem)

    expect(Buffer.compare(privateKey, imported)).toBe(0)
  })

  test("importPrivateKeyFromPEM handles newlines", async () => {
    const { privateKey } = await generateKeyPair()
    const pem = exportPrivateKeyToPEM(privateKey)

    // Add extra newlines
    const pemWithNewlines = pem.replace(/\n/g, "\n\n")
    const imported = importPrivateKeyFromPEM(pemWithNewlines)

    expect(Buffer.compare(privateKey, imported)).toBe(0)
  })
})

describe("Integration", () => {
  test("full workflow: create entry -> manifest -> XML -> parse", () => {
    const entry = createUpdateManifestEntry({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      version: "2.5.0",
      baseUrl: "https://cdn.example.com/extensions",
      hash: "a".repeat(64),
      size: 500000,
    })

    const manifest = createUpdateManifest(entry)
    const xml = generateUpdateManifestXML(manifest)
    const parsed = parseUpdateManifestXML(xml)

    expect(parsed.apps[0]?.appId).toBe(entry.appId)
    expect(parsed.apps[0]?.version).toBe(entry.version)
    expect(parsed.apps[0]?.codebase).toBe(entry.codebase)
    expect(parsed.apps[0]?.hash).toBe(entry.hash)
  })

  test("policy and server configs use same extension ID", async () => {
    const { publicKey } = await generateKeyPair()
    const extensionId = calculateExtensionId(publicKey)

    const policyConfig: MDMPolicyConfig = {
      provider: "generic",
      extensionId,
      updateUrl: "https://updates.example.com/extension.xml",
      forceInstall: true,
      pinToToolbar: true,
    }

    const serverConfig: UpdateServerConfig = {
      baseUrl: "https://updates.example.com",
      crxDirectory: "./releases",
      extensionId,
      currentVersion: "1.0.0",
      enableCors: true,
      cacheMaxAge: 3600,
    }

    const policyResult = validateMDMPolicyConfig(policyConfig)
    const serverResult = validateUpdateServerConfig(serverConfig)

    expect(policyResult.valid).toBe(true)
    expect(serverResult.valid).toBe(true)

    const policy = generateChromeEnterprisePolicy(policyConfig)
    expect(policy.ExtensionInstallForcelist![0]).toContain(extensionId)
  })
})
