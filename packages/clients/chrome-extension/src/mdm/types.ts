import { z } from "zod"

/**
 * MDM Distribution Types for Chrome Extension Enterprise Deployment.
 *
 * This module provides types for:
 * - MDM policy templates (Jamf, Intune, etc.)
 * - Chrome Enterprise policies
 * - Extension update manifests
 * - CRX packaging configuration
 */

/**
 * Chrome extension installation mode
 */
export const InstallationMode = z.enum([
  "allowed",
  "blocked",
  "force_installed",
  "normal_installed",
  "removed",
])
export type InstallationMode = z.infer<typeof InstallationMode>

/**
 * Chrome extension settings for a single extension
 */
export const ExtensionSettings = z.object({
  /** Installation mode for the extension */
  installation_mode: InstallationMode,
  /** URL to fetch extension updates from */
  update_url: z.string().url().optional(),
  /** Minimum version required */
  minimum_version_required: z.string().optional(),
  /** Whether to allow the extension in incognito mode */
  allowed_incognito: z.boolean().optional(),
  /** Blocked permissions for the extension */
  blocked_permissions: z.array(z.string()).optional(),
  /** Allowed permissions for the extension */
  allowed_permissions: z.array(z.string()).optional(),
  /** Blocked hosts */
  blocked_install_message: z.string().optional(),
  /** Toolbar pin setting */
  toolbar_state: z.enum(["default", "force_pinned", "force_shown"]).optional(),
})
export type ExtensionSettings = z.infer<typeof ExtensionSettings>

/**
 * Chrome Enterprise policy for extension management
 */
export const ChromeEnterprisePolicy = z.object({
  /** Force-install list in format "extensionId;updateUrl" */
  ExtensionInstallForcelist: z.array(z.string()).optional(),
  /** Block-install list of extension IDs */
  ExtensionInstallBlocklist: z.array(z.string()).optional(),
  /** Allow-install list of extension IDs */
  ExtensionInstallAllowlist: z.array(z.string()).optional(),
  /** Per-extension settings keyed by extension ID or wildcard */
  ExtensionSettings: z.record(z.string(), ExtensionSettings).optional(),
})
export type ChromeEnterprisePolicy = z.infer<typeof ChromeEnterprisePolicy>

/**
 * MDM provider type
 */
export const MDMProvider = z.enum([
  "jamf",
  "intune",
  "workspace_one",
  "kandji",
  "mosyle",
  "google_admin",
  "generic",
])
export type MDMProvider = z.infer<typeof MDMProvider>

/**
 * MDM policy template configuration
 */
export const MDMPolicyConfig = z.object({
  /** MDM provider type */
  provider: MDMProvider,
  /** Extension ID (public key hash) */
  extensionId: z.string(),
  /** Update server URL */
  updateUrl: z.string().url(),
  /** Whether to force install the extension */
  forceInstall: z.boolean().default(true),
  /** Minimum version requirement */
  minimumVersion: z.string().optional(),
  /** Allowed domains for the extension */
  allowedDomains: z.array(z.string()).optional(),
  /** Blocked domains for the extension */
  blockedDomains: z.array(z.string()).optional(),
  /** Custom install message if blocked */
  blockedMessage: z.string().optional(),
  /** Pin extension to toolbar */
  pinToToolbar: z.boolean().default(true),
})
export type MDMPolicyConfig = z.infer<typeof MDMPolicyConfig>

/**
 * Extension update manifest entry
 */
export const UpdateManifestEntry = z.object({
  /** App ID (extension ID) */
  appId: z.string(),
  /** Current version */
  version: z.string(),
  /** URL to download the CRX file */
  codebase: z.string().url(),
  /** SHA256 hash of the CRX file */
  hash: z.string().optional(),
  /** SHA256 hash algorithm */
  hashAlgorithm: z.literal("sha256").optional(),
  /** Size in bytes */
  size: z.number().optional(),
})
export type UpdateManifestEntry = z.infer<typeof UpdateManifestEntry>

/**
 * Extension update manifest (gupdate XML format)
 */
export const UpdateManifest = z.object({
  /** Protocol version (always "2.0") */
  protocol: z.literal("2.0").default("2.0"),
  /** List of app entries */
  apps: z.array(UpdateManifestEntry),
})
export type UpdateManifest = z.infer<typeof UpdateManifest>

/**
 * CRX packaging configuration
 */
export const CRXPackageConfig = z.object({
  /** Path to the extension source directory */
  sourceDir: z.string(),
  /** Path to the private key file (PEM format) */
  privateKeyPath: z.string().optional(),
  /** Output path for the CRX file */
  outputPath: z.string(),
  /** Version to embed in the package */
  version: z.string(),
})
export type CRXPackageConfig = z.infer<typeof CRXPackageConfig>

/**
 * CRX package result
 */
export const CRXPackageResult = z.object({
  /** Path to the generated CRX file */
  crxPath: z.string(),
  /** Extension ID derived from the public key */
  extensionId: z.string(),
  /** SHA256 hash of the CRX file */
  sha256: z.string(),
  /** Size in bytes */
  size: z.number(),
  /** Version of the packaged extension */
  version: z.string(),
  /** Path to the private key (may be newly generated) */
  privateKeyPath: z.string(),
})
export type CRXPackageResult = z.infer<typeof CRXPackageResult>

/**
 * Update server configuration
 */
export const UpdateServerConfig = z.object({
  /** Base URL for the update server */
  baseUrl: z.string().url(),
  /** Directory to serve CRX files from */
  crxDirectory: z.string(),
  /** Extension ID */
  extensionId: z.string(),
  /** Current version */
  currentVersion: z.string(),
  /** Enable CORS headers */
  enableCors: z.boolean().default(true),
  /** Cache control max-age in seconds */
  cacheMaxAge: z.number().default(3600),
})
export type UpdateServerConfig = z.infer<typeof UpdateServerConfig>
