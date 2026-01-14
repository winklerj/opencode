import { z } from "zod"

/**
 * GitHub App configuration
 */
export const GitHubAppConfig = z.object({
  appId: z.string(),
  privateKey: z.string(),
  installationId: z.string(),
})
export type GitHubAppConfig = z.infer<typeof GitHubAppConfig>

/**
 * GitHub installation access token response
 */
export const InstallationToken = z.object({
  token: z.string(),
  expires_at: z.string(),
  permissions: z.record(z.string(), z.string()).optional(),
  repository_selection: z.enum(["all", "selected"]).optional(),
})
export type InstallationToken = z.infer<typeof InstallationToken>

/**
 * Error thrown when GitHub API calls fail
 */
export class GitHubAppError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
  ) {
    super(message)
    this.name = "GitHubAppError"
  }
}

/**
 * Generate a JWT (JSON Web Token) for GitHub App authentication.
 *
 * GitHub Apps authenticate using JWT tokens signed with the app's private key.
 * The JWT contains:
 * - iss: The App ID
 * - iat: Issued at time (60 seconds in the past to handle clock drift)
 * - exp: Expiration time (10 minutes from now, GitHub's max)
 *
 * @param appId - The GitHub App ID
 * @param privateKey - The GitHub App's private key (PEM format)
 * @returns A signed JWT string
 */
export function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)

  // JWT header
  const header = {
    alg: "RS256",
    typ: "JWT",
  }

  // JWT payload
  const payload = {
    // Issued at time - 60 seconds in the past to allow for clock drift
    iat: now - 60,
    // JWT expiration time (10 minute maximum)
    exp: now + 600,
    // GitHub App ID
    iss: appId,
  }

  // Base64url encode helper
  const base64url = (obj: object): string => {
    const json = JSON.stringify(obj)
    const base64 = Buffer.from(json).toString("base64")
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }

  // Create unsigned token
  const unsignedToken = `${base64url(header)}.${base64url(payload)}`

  // Sign with RSA-SHA256
  const sign = require("crypto").createSign("RSA-SHA256")
  sign.update(unsignedToken)

  // Handle different private key formats
  const normalizedKey = normalizePrivateKey(privateKey)
  const signature = sign.sign(normalizedKey, "base64")

  // Convert signature to base64url
  const signatureBase64url = signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

  return `${unsignedToken}.${signatureBase64url}`
}

/**
 * Normalize a private key to PEM format.
 * Handles keys that may have been stored with escaped newlines or as a single line.
 */
function normalizePrivateKey(privateKey: string): string {
  // If it already looks like a properly formatted PEM key, return it
  if (privateKey.includes("\n")) {
    return privateKey
  }

  // Handle escaped newlines
  if (privateKey.includes("\\n")) {
    return privateKey.replace(/\\n/g, "\n")
  }

  // Handle single-line keys (base64 encoded)
  if (!privateKey.startsWith("-----")) {
    return `-----BEGIN RSA PRIVATE KEY-----\n${privateKey}\n-----END RSA PRIVATE KEY-----\n`
  }

  return privateKey
}

/**
 * Get an installation access token from GitHub.
 *
 * This token allows the GitHub App to authenticate as an installation,
 * providing access to repositories where the app is installed.
 *
 * @param appId - The GitHub App ID
 * @param privateKey - The GitHub App's private key (PEM format)
 * @param installationId - The installation ID to get a token for
 * @returns The installation access token and metadata
 */
export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<InstallationToken> {
  const jwt = generateJWT(appId, privateKey)

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new GitHubAppError(`Failed to get installation token: ${response.status} ${response.statusText}`, response.status, errorBody)
  }

  const data = await response.json()
  return InstallationToken.parse(data)
}

/**
 * Clone a repository using GitHub App authentication.
 *
 * This function:
 * 1. Gets an installation access token
 * 2. Constructs the clone URL with the token
 * 3. Executes git clone using the token for authentication
 *
 * @param config - GitHub App configuration
 * @param repository - Repository to clone (e.g., "org/repo")
 * @param targetDir - Directory to clone into
 * @param branch - Branch to clone (optional)
 * @returns The git commit SHA of the cloned repository
 */
export async function cloneWithAppToken(
  config: GitHubAppConfig,
  repository: string,
  targetDir: string,
  branch?: string,
): Promise<string> {
  const { token } = await getInstallationToken(config.appId, config.privateKey, config.installationId)

  // Normalize repository name (remove github.com prefix if present)
  const repoPath = repository.replace(/^(?:https?:\/\/)?github\.com\//, "").replace(/\.git$/, "")

  const cloneUrl = `https://x-access-token:${token}@github.com/${repoPath}.git`

  // Build git clone command
  const args = ["clone"]

  if (branch) {
    args.push("--branch", branch)
  }

  // Shallow clone for faster builds
  args.push("--depth", "1")
  args.push(cloneUrl, targetDir)

  // Execute git clone
  const { execFile } = require("child_process")
  const { promisify } = require("util")
  const execFileAsync = promisify(execFile)

  try {
    await execFileAsync("git", args, {
      // Don't pass token to shell
      shell: false,
      // Set timeout to 5 minutes
      timeout: 300000,
    })
  } catch (error) {
    // Sanitize error message to not leak token
    const errorMessage = error instanceof Error ? error.message.replace(token, "[REDACTED]") : String(error)
    throw new GitHubAppError(`Failed to clone repository: ${errorMessage}`)
  }

  // Get the commit SHA
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: targetDir,
    shell: false,
  })

  return stdout.trim()
}

/**
 * Verify that a GitHub App has access to a repository.
 *
 * @param config - GitHub App configuration
 * @param repository - Repository to check (e.g., "org/repo")
 * @returns true if the app has access
 */
export async function verifyRepositoryAccess(config: GitHubAppConfig, repository: string): Promise<boolean> {
  const { token } = await getInstallationToken(config.appId, config.privateKey, config.installationId)

  // Normalize repository name
  const repoPath = repository.replace(/^(?:https?:\/\/)?github\.com\//, "").replace(/\.git$/, "")

  const response = await fetch(`https://api.github.com/repos/${repoPath}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  return response.ok
}

/**
 * List repositories that the GitHub App installation has access to.
 *
 * @param config - GitHub App configuration
 * @returns List of repository full names (e.g., "org/repo")
 */
export async function listAccessibleRepositories(config: GitHubAppConfig): Promise<string[]> {
  const { token } = await getInstallationToken(config.appId, config.privateKey, config.installationId)

  const repositories: string[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const response = await fetch(`https://api.github.com/installation/repositories?page=${page}&per_page=${perPage}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })

    if (!response.ok) {
      throw new GitHubAppError(`Failed to list repositories: ${response.status} ${response.statusText}`, response.status)
    }

    const data = (await response.json()) as { repositories: Array<{ full_name: string }>; total_count: number }
    repositories.push(...data.repositories.map((r) => r.full_name))

    // Check if we have all repositories
    if (repositories.length >= data.total_count || data.repositories.length < perPage) {
      break
    }

    page++
  }

  return repositories
}

/**
 * Create a GitHubApp client instance with cached tokens.
 */
export class GitHubAppClient {
  private tokenCache: { token: string; expiresAt: Date } | null = null
  private config: GitHubAppConfig

  constructor(config: GitHubAppConfig) {
    this.config = GitHubAppConfig.parse(config)
  }

  /**
   * Get an installation token, using cache if valid.
   * Tokens are refreshed 5 minutes before expiry.
   */
  async getToken(): Promise<string> {
    const now = new Date()
    const bufferMs = 5 * 60 * 1000 // 5 minute buffer

    if (this.tokenCache && this.tokenCache.expiresAt.getTime() - bufferMs > now.getTime()) {
      return this.tokenCache.token
    }

    const result = await getInstallationToken(this.config.appId, this.config.privateKey, this.config.installationId)

    this.tokenCache = {
      token: result.token,
      expiresAt: new Date(result.expires_at),
    }

    return result.token
  }

  /**
   * Clone a repository using the app's credentials.
   */
  async clone(repository: string, targetDir: string, branch?: string): Promise<string> {
    return cloneWithAppToken(this.config, repository, targetDir, branch)
  }

  /**
   * Check if the app has access to a repository.
   */
  async hasAccess(repository: string): Promise<boolean> {
    return verifyRepositoryAccess(this.config, repository)
  }

  /**
   * List all accessible repositories.
   */
  async listRepositories(): Promise<string[]> {
    return listAccessibleRepositories(this.config)
  }

  /**
   * Clear the token cache (useful for testing or when token is revoked).
   */
  clearCache(): void {
    this.tokenCache = null
  }
}
