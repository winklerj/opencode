import type { ChromeEnterprisePolicy, MDMPolicyConfig, MDMProvider } from "./types"

/**
 * MDM Policy Templates for Chrome Extension Enterprise Deployment.
 *
 * Generates policy configurations for various MDM providers:
 * - Jamf (macOS)
 * - Microsoft Intune
 * - VMware Workspace ONE
 * - Kandji
 * - Mosyle
 * - Google Admin Console
 */

/**
 * Generate a Chrome Enterprise policy for extension management
 */
export function generateChromeEnterprisePolicy(config: MDMPolicyConfig): ChromeEnterprisePolicy {
  const policy: ChromeEnterprisePolicy = {}

  if (config.forceInstall) {
    policy.ExtensionInstallForcelist = [`${config.extensionId};${config.updateUrl}`]
  }

  policy.ExtensionSettings = {
    [config.extensionId]: {
      installation_mode: config.forceInstall ? "force_installed" : "allowed",
      update_url: config.updateUrl,
      minimum_version_required: config.minimumVersion,
      toolbar_state: config.pinToToolbar ? "force_pinned" : "default",
      blocked_install_message: config.blockedMessage,
    },
  }

  return policy
}

/**
 * Generate an MDM policy template for a specific provider
 */
export function generateMDMPolicyTemplate(config: MDMPolicyConfig): string {
  switch (config.provider) {
    case "jamf":
      return generateJamfTemplate(config)
    case "intune":
      return generateIntuneTemplate(config)
    case "workspace_one":
      return generateWorkspaceOneTemplate(config)
    case "kandji":
      return generateKandjiTemplate(config)
    case "mosyle":
      return generateMosyleTemplate(config)
    case "google_admin":
      return generateGoogleAdminTemplate(config)
    case "generic":
    default:
      return generateGenericTemplate(config)
  }
}

/**
 * Generate Jamf Pro configuration profile (plist format)
 */
function generateJamfTemplate(config: MDMPolicyConfig): string {
  const chromePolicy = generateChromeEnterprisePolicy(config)

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.google.Chrome</string>
            <key>PayloadIdentifier</key>
            <string>com.opencode.chrome.extension</string>
            <key>PayloadUUID</key>
            <string>REPLACE-WITH-UUID</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadDisplayName</key>
            <string>OpenCode Chrome Extension</string>
            <key>PayloadDescription</key>
            <string>Installs the OpenCode Visual Editor Chrome extension</string>
            <key>PayloadOrganization</key>
            <string>OpenCode</string>
            ${config.forceInstall ? `<key>ExtensionInstallForcelist</key>
            <array>
                <string>${config.extensionId};${config.updateUrl}</string>
            </array>` : ""}
            <key>ExtensionSettings</key>
            <dict>
                <key>${config.extensionId}</key>
                <dict>
                    <key>installation_mode</key>
                    <string>${config.forceInstall ? "force_installed" : "allowed"}</string>
                    <key>update_url</key>
                    <string>${config.updateUrl}</string>
                    ${config.minimumVersion ? `<key>minimum_version_required</key>
                    <string>${config.minimumVersion}</string>` : ""}
                    ${config.pinToToolbar ? `<key>toolbar_state</key>
                    <string>force_pinned</string>` : ""}
                </dict>
            </dict>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>OpenCode Chrome Extension Policy</string>
    <key>PayloadIdentifier</key>
    <string>com.opencode.chrome.profile</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>REPLACE-WITH-PROFILE-UUID</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`
}

/**
 * Generate Microsoft Intune OMA-URI settings
 */
function generateIntuneTemplate(config: MDMPolicyConfig): string {
  const chromePolicy = generateChromeEnterprisePolicy(config)

  return JSON.stringify(
    {
      displayName: "OpenCode Chrome Extension Policy",
      description: "Policy to install the OpenCode Visual Editor Chrome extension",
      omaSettings: [
        {
          displayName: "ExtensionInstallForcelist",
          description: "Force-installs the OpenCode extension",
          omaUri: "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome~Extensions/ExtensionInstallForcelist",
          value: `<enabled/><data id="ExtensionInstallForcelistDesc" value="1&#xF000;${config.extensionId};${config.updateUrl}"/>`,
        },
        {
          displayName: "ExtensionSettings",
          description: "Extension-specific settings for OpenCode",
          omaUri: "./Device/Vendor/MSFT/Policy/Config/Chrome~Policy~googlechrome~Extensions/ExtensionSettings",
          value: `<enabled/><data id="ExtensionSettings" value="${escapeJsonForXml(JSON.stringify(chromePolicy.ExtensionSettings))}"/>`,
        },
      ],
    },
    null,
    2,
  )
}

/**
 * Generate VMware Workspace ONE profile
 */
function generateWorkspaceOneTemplate(config: MDMPolicyConfig): string {
  const chromePolicy = generateChromeEnterprisePolicy(config)

  return JSON.stringify(
    {
      name: "OpenCode Chrome Extension Policy",
      description: "Workspace ONE profile for OpenCode Chrome extension",
      platform: "Windows",
      profileType: "Chrome Browser",
      settings: {
        ExtensionInstallForcelist: chromePolicy.ExtensionInstallForcelist,
        ExtensionSettings: chromePolicy.ExtensionSettings,
      },
    },
    null,
    2,
  )
}

/**
 * Generate Kandji custom profile
 */
function generateKandjiTemplate(config: MDMPolicyConfig): string {
  // Kandji uses the same plist format as Jamf
  return generateJamfTemplate(config)
}

/**
 * Generate Mosyle configuration
 */
function generateMosyleTemplate(config: MDMPolicyConfig): string {
  // Mosyle uses the same plist format as Jamf
  return generateJamfTemplate(config)
}

/**
 * Generate Google Admin Console JSON policy
 */
function generateGoogleAdminTemplate(config: MDMPolicyConfig): string {
  const chromePolicy = generateChromeEnterprisePolicy(config)

  return JSON.stringify(
    {
      displayName: "OpenCode Chrome Extension",
      description: "Google Admin policy for OpenCode Visual Editor Chrome extension",
      policyType: "CHROME_BROWSER",
      policy: {
        ExtensionInstallForcelist: chromePolicy.ExtensionInstallForcelist,
        ExtensionSettings: chromePolicy.ExtensionSettings,
      },
      targetResource: "ORG_UNIT",
      notes: "Apply to organizational units containing users who need the OpenCode extension",
    },
    null,
    2,
  )
}

/**
 * Generate a generic JSON policy template
 */
function generateGenericTemplate(config: MDMPolicyConfig): string {
  const chromePolicy = generateChromeEnterprisePolicy(config)

  return JSON.stringify(
    {
      name: "OpenCode Chrome Extension Policy",
      description: "Generic MDM policy for OpenCode Visual Editor Chrome extension",
      extensionId: config.extensionId,
      updateUrl: config.updateUrl,
      chromePolicy,
      instructions: {
        forceInstall: `Add "${config.extensionId};${config.updateUrl}" to ExtensionInstallForcelist`,
        settings: "Apply the ExtensionSettings object to configure extension behavior",
        notes: [
          "The extension ID is derived from the public key in manifest.json",
          "Ensure the update URL is accessible from managed devices",
          "Test in a pilot group before broad deployment",
        ],
      },
    },
    null,
    2,
  )
}

/**
 * Escape JSON string for embedding in XML
 */
function escapeJsonForXml(json: string): string {
  return json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Get supported MDM providers
 */
export function getSupportedMDMProviders(): MDMProvider[] {
  return ["jamf", "intune", "workspace_one", "kandji", "mosyle", "google_admin", "generic"]
}

/**
 * Get MDM provider display name
 */
export function getMDMProviderDisplayName(provider: MDMProvider): string {
  const names: Record<MDMProvider, string> = {
    jamf: "Jamf Pro",
    intune: "Microsoft Intune",
    workspace_one: "VMware Workspace ONE",
    kandji: "Kandji",
    mosyle: "Mosyle",
    google_admin: "Google Admin Console",
    generic: "Generic JSON",
  }
  return names[provider]
}

/**
 * Validate MDM policy configuration
 */
export function validateMDMPolicyConfig(config: MDMPolicyConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.extensionId || config.extensionId.length !== 32) {
    errors.push("Extension ID must be 32 lowercase letters")
  }

  if (!/^[a-z]{32}$/.test(config.extensionId)) {
    errors.push("Extension ID must contain only lowercase letters a-p")
  }

  try {
    new URL(config.updateUrl)
  } catch {
    errors.push("Update URL must be a valid URL")
  }

  if (config.minimumVersion && !/^\d+(\.\d+)*$/.test(config.minimumVersion)) {
    errors.push("Minimum version must be in format X.Y.Z")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
