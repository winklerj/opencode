import type { UpdateManifest, UpdateManifestEntry } from "./types"

/**
 * Update Manifest Generator for Chrome Extension MDM Distribution.
 *
 * Generates XML manifests in the Google Update (gupdate) format
 * required for Chrome extension self-hosting.
 *
 * @see https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux
 */

/**
 * Generate an update manifest XML string from a manifest object
 */
export function generateUpdateManifestXML(manifest: UpdateManifest): string {
  const lines: string[] = [
    `<?xml version='1.0' encoding='UTF-8'?>`,
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='${manifest.protocol}'>`,
  ]

  for (const app of manifest.apps) {
    lines.push(`  <app appid='${escapeXML(app.appId)}'>`)

    const updateAttrs: string[] = [`codebase='${escapeXML(app.codebase)}'`, `version='${escapeXML(app.version)}'`]

    if (app.hash && app.hashAlgorithm) {
      updateAttrs.push(`hash='${escapeXML(app.hash)}'`)
      updateAttrs.push(`hash_sha256='${escapeXML(app.hash)}'`)
    }

    if (app.size !== undefined) {
      updateAttrs.push(`size='${app.size}'`)
    }

    lines.push(`    <updatecheck ${updateAttrs.join(" ")} />`)
    lines.push(`  </app>`)
  }

  lines.push(`</gupdate>`)

  return lines.join("\n")
}

/**
 * Create an update manifest for a single extension
 */
export function createUpdateManifest(entry: UpdateManifestEntry): UpdateManifest {
  return {
    protocol: "2.0",
    apps: [entry],
  }
}

/**
 * Create an update manifest entry
 */
export function createUpdateManifestEntry(options: {
  extensionId: string
  version: string
  baseUrl: string
  filename?: string
  hash?: string
  size?: number
}): UpdateManifestEntry {
  const filename = options.filename ?? `opencode-extension-${options.version}.crx`
  const codebase = options.baseUrl.endsWith("/") ? `${options.baseUrl}${filename}` : `${options.baseUrl}/${filename}`

  return {
    appId: options.extensionId,
    version: options.version,
    codebase,
    hash: options.hash,
    hashAlgorithm: options.hash ? "sha256" : undefined,
    size: options.size,
  }
}

/**
 * Parse an update manifest XML string into a manifest object
 */
export function parseUpdateManifestXML(xml: string): UpdateManifest {
  const apps: UpdateManifestEntry[] = []

  // Simple regex-based parsing (avoids XML parser dependency)
  const appMatches = xml.matchAll(/<app\s+appid=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/app>/g)

  for (const match of appMatches) {
    const appId = match[1]
    const appContent = match[2]

    if (!appId || !appContent) continue

    const updatecheckMatch = appContent.match(/<updatecheck\s+([^>]+)\/?>/)

    if (!updatecheckMatch || !updatecheckMatch[1]) continue

    const attrs = updatecheckMatch[1]
    const codebase = extractAttr(attrs, "codebase")
    const version = extractAttr(attrs, "version")
    const hash = extractAttr(attrs, "hash_sha256") ?? extractAttr(attrs, "hash")
    const sizeStr = extractAttr(attrs, "size")

    if (!codebase || !version) continue

    apps.push({
      appId,
      version,
      codebase,
      hash,
      hashAlgorithm: hash ? "sha256" : undefined,
      size: sizeStr ? parseInt(sizeStr, 10) : undefined,
    })
  }

  return {
    protocol: "2.0",
    apps,
  }
}

/**
 * Extract an attribute value from an attribute string
 */
function extractAttr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}=['"]([^'"]+)['"]`))
  return match?.[1]
}

/**
 * Escape special characters for XML
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Validate an update manifest
 */
export function validateUpdateManifest(manifest: UpdateManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (manifest.protocol !== "2.0") {
    errors.push(`Invalid protocol version: ${manifest.protocol}. Expected "2.0"`)
  }

  if (manifest.apps.length === 0) {
    errors.push("Manifest must contain at least one app entry")
  }

  for (let i = 0; i < manifest.apps.length; i++) {
    const app = manifest.apps[i]
    if (!app) continue

    if (!app.appId || app.appId.length !== 32) {
      errors.push(`App ${i}: Invalid extension ID. Must be 32 lowercase letters.`)
    }

    if (!app.version || !/^\d+(\.\d+)*$/.test(app.version)) {
      errors.push(`App ${i}: Invalid version format. Must be dot-separated numbers.`)
    }

    if (!app.codebase || !app.codebase.startsWith("http")) {
      errors.push(`App ${i}: Invalid codebase URL.`)
    }

    if (app.hash && !/^[a-fA-F0-9]{64}$/.test(app.hash)) {
      errors.push(`App ${i}: Invalid SHA256 hash format.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
