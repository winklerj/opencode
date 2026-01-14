/**
 * MDM Distribution Module for Chrome Extension Enterprise Deployment.
 *
 * This module provides everything needed for enterprise distribution
 * of the OpenCode Chrome extension via MDM (Mobile Device Management):
 *
 * - Policy Templates: Generate configuration profiles for Jamf, Intune,
 *   Workspace ONE, Kandji, Mosyle, and Google Admin Console
 *
 * - Update Manifest: Generate XML manifests for self-hosted extension updates
 *
 * - Update Server: Hono route handlers for serving extension updates
 *
 * - CRX Packager: Create signed CRX3 packages for distribution
 *
 * @example
 * ```typescript
 * import {
 *   packageExtension,
 *   generateMDMPolicyTemplate,
 *   createUpdateServerHandlers,
 * } from "@opencode-ai/chrome-extension/mdm"
 *
 * // Package the extension
 * const result = await packageExtension({
 *   sourceDir: "./dist",
 *   outputPath: "./releases/opencode-extension-1.0.0.crx",
 *   version: "1.0.0",
 * })
 *
 * // Generate MDM policy
 * const policy = generateMDMPolicyTemplate({
 *   provider: "jamf",
 *   extensionId: result.extensionId,
 *   updateUrl: "https://updates.example.com/extension.xml",
 *   forceInstall: true,
 *   pinToToolbar: true,
 * })
 *
 * // Set up update server
 * const handlers = createUpdateServerHandlers({
 *   baseUrl: "https://updates.example.com",
 *   crxDirectory: "./releases",
 *   extensionId: result.extensionId,
 *   currentVersion: "1.0.0",
 * })
 * ```
 */

// Types
export * from "./types"

// Update manifest generation
export {
  generateUpdateManifestXML,
  createUpdateManifest,
  createUpdateManifestEntry,
  parseUpdateManifestXML,
  validateUpdateManifest,
} from "./update-manifest"

// MDM policy templates
export {
  generateChromeEnterprisePolicy,
  generateMDMPolicyTemplate,
  getSupportedMDMProviders,
  getMDMProviderDisplayName,
  validateMDMPolicyConfig,
} from "./policy-templates"

// Update server
export {
  createUpdateServerHandlers,
  createHonoRoutes,
  validateUpdateServerConfig,
  generateNginxConfig,
  generateCloudflareWorkerScript,
  type UpdateServerHandlers,
  type HonoRouteConfig,
} from "./update-server"

// CRX packager
export {
  packageExtension,
  generateKeyPair,
  exportPrivateKeyToPEM,
  importPrivateKeyFromPEM,
  calculateExtensionId,
  verifyCRXFile,
  extractCRXContent,
} from "./crx-packager"
