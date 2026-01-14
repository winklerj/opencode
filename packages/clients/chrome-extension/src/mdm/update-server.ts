import type { UpdateServerConfig } from "./types"
import { createUpdateManifest, createUpdateManifestEntry, generateUpdateManifestXML } from "./update-manifest"

/**
 * Extension Update Server for Chrome Extension MDM Distribution.
 *
 * Provides utilities for serving Chrome extension updates:
 * - Update manifest XML generation
 * - CRX file serving with proper headers
 * - Version management
 *
 * This can be integrated with Hono or any other web framework.
 */

export interface UpdateServerHandlers {
  /** Handle GET /extension.xml - returns update manifest */
  handleManifestRequest: (request: Request) => Promise<Response>
  /** Handle GET /opencode-extension-{version}.crx - returns CRX file */
  handleCRXRequest: (request: Request, version: string) => Promise<Response>
  /** Handle GET /latest.json - returns current version info */
  handleVersionRequest: (request: Request) => Promise<Response>
}

/**
 * Create update server handlers for a Hono-style server
 */
export function createUpdateServerHandlers(config: UpdateServerConfig): UpdateServerHandlers {
  return {
    handleManifestRequest: async (request: Request) => {
      const entry = createUpdateManifestEntry({
        extensionId: config.extensionId,
        version: config.currentVersion,
        baseUrl: config.baseUrl,
      })

      const manifest = createUpdateManifest(entry)
      const xml = generateUpdateManifestXML(manifest)

      const headers = new Headers({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": `public, max-age=${config.cacheMaxAge}`,
      })

      if (config.enableCors) {
        headers.set("Access-Control-Allow-Origin", "*")
        headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
      }

      return new Response(xml, { status: 200, headers })
    },

    handleCRXRequest: async (request: Request, version: string) => {
      const crxPath = `${config.crxDirectory}/opencode-extension-${version}.crx`

      try {
        const file = Bun.file(crxPath)
        const exists = await file.exists()

        if (!exists) {
          return new Response(JSON.stringify({ error: "Version not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        }

        const buffer = await file.arrayBuffer()

        const headers = new Headers({
          "Content-Type": "application/x-chrome-extension",
          "Content-Length": buffer.byteLength.toString(),
          "Content-Disposition": `attachment; filename="opencode-extension-${version}.crx"`,
          "Cache-Control": `public, max-age=${config.cacheMaxAge}`,
        })

        if (config.enableCors) {
          headers.set("Access-Control-Allow-Origin", "*")
          headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        }

        return new Response(buffer, { status: 200, headers })
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "Failed to read CRX file" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        )
      }
    },

    handleVersionRequest: async (request: Request) => {
      const headers = new Headers({
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${Math.floor(config.cacheMaxAge / 4)}`,
      })

      if (config.enableCors) {
        headers.set("Access-Control-Allow-Origin", "*")
        headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
      }

      return new Response(
        JSON.stringify({
          extensionId: config.extensionId,
          currentVersion: config.currentVersion,
          updateUrl: `${config.baseUrl}/extension.xml`,
          downloadUrl: `${config.baseUrl}/opencode-extension-${config.currentVersion}.crx`,
        }),
        { status: 200, headers },
      )
    },
  }
}

/**
 * Configuration for Hono route registration
 */
export interface HonoRouteConfig {
  /** Base path for routes (default: "/extension-updates") */
  basePath?: string
  /** Update server configuration */
  serverConfig: UpdateServerConfig
}

/**
 * Create route definitions for a Hono app
 *
 * @example
 * ```typescript
 * import { Hono } from "hono"
 * import { registerUpdateRoutes } from "./update-server"
 *
 * const app = new Hono()
 * registerUpdateRoutes(app, {
 *   basePath: "/extension-updates",
 *   serverConfig: {
 *     baseUrl: "https://updates.example.com/extension-updates",
 *     crxDirectory: "./releases",
 *     extensionId: "abcdefghijklmnopabcdefghijklmnop",
 *     currentVersion: "1.0.0",
 *   }
 * })
 * ```
 */
export function createHonoRoutes(config: HonoRouteConfig): {
  path: string
  method: "GET"
  handler: (c: { req: Request; param: (name: string) => string }) => Promise<Response>
}[] {
  const basePath = config.basePath ?? "/extension-updates"
  const handlers = createUpdateServerHandlers(config.serverConfig)

  return [
    {
      path: `${basePath}/extension.xml`,
      method: "GET",
      handler: async (c) => handlers.handleManifestRequest(c.req),
    },
    {
      path: `${basePath}/opencode-extension-:version.crx`,
      method: "GET",
      handler: async (c) => handlers.handleCRXRequest(c.req, c.param("version")),
    },
    {
      path: `${basePath}/latest.json`,
      method: "GET",
      handler: async (c) => handlers.handleVersionRequest(c.req),
    },
  ]
}

/**
 * Validate update server configuration
 */
export function validateUpdateServerConfig(config: UpdateServerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  try {
    new URL(config.baseUrl)
  } catch {
    errors.push("Base URL must be a valid URL")
  }

  if (!config.crxDirectory) {
    errors.push("CRX directory is required")
  }

  if (!config.extensionId || config.extensionId.length !== 32) {
    errors.push("Extension ID must be 32 lowercase letters")
  }

  if (!config.currentVersion || !/^\d+(\.\d+)*$/.test(config.currentVersion)) {
    errors.push("Current version must be in format X.Y.Z")
  }

  if (config.cacheMaxAge < 0) {
    errors.push("Cache max-age must be non-negative")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate a sample nginx configuration for serving extension updates
 */
export function generateNginxConfig(config: UpdateServerConfig): string {
  const basePath = new URL(config.baseUrl).pathname

  return `# Nginx configuration for Chrome Extension Update Server
# Place this in your server block

location ${basePath} {
    # CRX files
    location ~* \\.crx$ {
        add_header Content-Type application/x-chrome-extension;
        add_header Cache-Control "public, max-age=${config.cacheMaxAge}";
        add_header Access-Control-Allow-Origin *;
    }

    # XML manifest
    location = ${basePath}/extension.xml {
        add_header Content-Type "application/xml; charset=utf-8";
        add_header Cache-Control "public, max-age=${config.cacheMaxAge}";
        add_header Access-Control-Allow-Origin *;
    }

    # JSON version info
    location = ${basePath}/latest.json {
        add_header Content-Type application/json;
        add_header Cache-Control "public, max-age=${Math.floor(config.cacheMaxAge / 4)}";
        add_header Access-Control-Allow-Origin *;
    }

    root /var/www/extension-updates;
    try_files $uri =404;
}
`
}

/**
 * Generate a sample Cloudflare Workers script for serving extension updates
 */
export function generateCloudflareWorkerScript(config: UpdateServerConfig): string {
  return `// Cloudflare Workers script for Chrome Extension Update Server
// Deploy using wrangler: wrangler deploy

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle extension.xml
    if (path === "/extension.xml") {
      const xml = \`<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${config.extensionId}'>
    <updatecheck codebase='${config.baseUrl}/opencode-extension-${config.currentVersion}.crx'
                 version='${config.currentVersion}' />
  </app>
</gupdate>\`;

      return new Response(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=${config.cacheMaxAge}",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Handle CRX files
    const crxMatch = path.match(/^\\/opencode-extension-([\\d.]+)\\.crx$/);
    if (crxMatch) {
      const version = crxMatch[1];
      const crxObject = await env.EXTENSION_BUCKET.get(\`opencode-extension-\${version}.crx\`);

      if (!crxObject) {
        return new Response(JSON.stringify({ error: "Version not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(crxObject.body, {
        headers: {
          "Content-Type": "application/x-chrome-extension",
          "Cache-Control": "public, max-age=${config.cacheMaxAge}",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Handle latest.json
    if (path === "/latest.json") {
      return new Response(JSON.stringify({
        extensionId: "${config.extensionId}",
        currentVersion: "${config.currentVersion}",
        updateUrl: "${config.baseUrl}/extension.xml",
        downloadUrl: "${config.baseUrl}/opencode-extension-${config.currentVersion}.crx",
      }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=${Math.floor(config.cacheMaxAge / 4)}",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
`
}
