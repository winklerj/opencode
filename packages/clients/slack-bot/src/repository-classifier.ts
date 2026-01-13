import type { RepositoryContext, ChannelConfig } from "./types"

/**
 * Context for classifying repository
 */
export interface ClassifyContext {
  channelID: string
  text: string
  channelName?: string
  channelTopic?: string
}

/**
 * RepositoryClassifier determines which repository a Slack message relates to.
 *
 * Classification sources (in priority order):
 * 1. Explicit GitHub link in message
 * 2. Explicit @mention of repo (e.g., "in owner/repo")
 * 3. Channel topic containing repo info
 * 4. Channel name matching repo pattern
 * 5. Message history analysis
 * 6. Channel default configuration
 * 7. Global default
 */
export class RepositoryClassifier {
  /** Channel-specific configurations */
  private channelConfigs: Map<string, ChannelConfig> = new Map()

  /** Global default repository */
  private defaultRepository?: string

  /** Global default branch */
  private defaultBranch: string = "main"

  constructor(config?: { defaultRepository?: string; defaultBranch?: string }) {
    this.defaultRepository = config?.defaultRepository
    this.defaultBranch = config?.defaultBranch ?? "main"
  }

  /**
   * Configure a channel's default repository
   */
  configureChannel(config: ChannelConfig): void {
    this.channelConfigs.set(config.channelID, config)
  }

  /**
   * Get channel configuration
   */
  getChannelConfig(channelID: string): ChannelConfig | undefined {
    return this.channelConfigs.get(channelID)
  }

  /**
   * Remove channel configuration
   */
  removeChannelConfig(channelID: string): boolean {
    return this.channelConfigs.delete(channelID)
  }

  /**
   * List all configured channels
   */
  listChannelConfigs(): ChannelConfig[] {
    return Array.from(this.channelConfigs.values())
  }

  /**
   * Classify the repository from message context
   */
  async classify(context: ClassifyContext): Promise<RepositoryContext> {
    // 1. Check for explicit GitHub links
    const linkResult = this.extractFromGitHubLink(context.text)
    if (linkResult) {
      return linkResult
    }

    // 2. Check for explicit repo mentions
    const mentionResult = this.extractFromMention(context.text)
    if (mentionResult) {
      return mentionResult
    }

    // 3. Check channel topic if provided
    if (context.channelTopic) {
      const topicResult = this.extractFromTopic(context.channelTopic)
      if (topicResult) {
        return topicResult
      }
    }

    // 4. Check channel name if provided
    if (context.channelName) {
      const nameResult = this.extractFromChannelName(context.channelName)
      if (nameResult) {
        return nameResult
      }
    }

    // 5. Check channel configuration
    const channelConfig = this.channelConfigs.get(context.channelID)
    if (channelConfig?.defaultRepository) {
      return {
        repository: channelConfig.defaultRepository,
        branch: channelConfig.defaultBranch ?? this.defaultBranch,
        source: "channel_topic", // We use channel config as if it was from topic
        confidence: 0.8,
      }
    }

    // 6. Fall back to global default
    if (this.defaultRepository) {
      return {
        repository: this.defaultRepository,
        branch: this.defaultBranch,
        source: "default",
        confidence: 0.3,
      }
    }

    // No repository found
    return {
      repository: undefined,
      source: "default",
      confidence: 0,
    }
  }

  /**
   * Extract repository from GitHub link
   */
  private extractFromGitHubLink(text: string): RepositoryContext | null {
    // Match GitHub URLs: github.com/owner/repo or github.com/owner/repo/...
    const githubUrlPattern = /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/g

    const matches = text.matchAll(githubUrlPattern)
    for (const match of matches) {
      const owner = match[1]
      const repo = match[2]
      if (owner && repo) {
        // Extract branch from URL if present
        let branch: string | undefined
        const branchPattern = /github\.com\/[^/]+\/[^/]+\/(tree|blob)\/([^/]+)/
        const branchMatch = text.match(branchPattern)
        if (branchMatch?.[2]) {
          branch = branchMatch[2]
        }

        return {
          repository: `${owner}/${repo}`,
          branch: branch ?? this.defaultBranch,
          source: "link",
          confidence: 1.0,
        }
      }
    }

    return null
  }

  /**
   * Extract repository from text mention (e.g., "in owner/repo" or "for owner/repo")
   */
  private extractFromMention(text: string): RepositoryContext | null {
    // Match patterns like "in owner/repo", "for owner/repo", "on owner/repo"
    const mentionPatterns = [
      /\b(?:in|for|on|at|from|repo|repository)[:\s]+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i,
      /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(?:repo|repository)/i,
    ]

    for (const pattern of mentionPatterns) {
      const match = text.match(pattern)
      if (match?.[1]) {
        return {
          repository: match[1],
          branch: this.defaultBranch,
          source: "mention",
          confidence: 0.9,
        }
      }
    }

    return null
  }

  /**
   * Extract repository from channel topic
   */
  private extractFromTopic(topic: string): RepositoryContext | null {
    // Check for GitHub links first
    const linkResult = this.extractFromGitHubLink(topic)
    if (linkResult) {
      return { ...linkResult, source: "channel_topic" }
    }

    // Check for repo pattern in topic
    const repoPattern = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/
    const match = topic.match(repoPattern)
    if (match?.[1]) {
      // Validate it looks like a repo (not a date or version)
      const repo = match[1]
      if (!repo.match(/^\d+\/\d+$/) && !repo.match(/^v?\d+\.\d+/)) {
        return {
          repository: repo,
          branch: this.defaultBranch,
          source: "channel_topic",
          confidence: 0.7,
        }
      }
    }

    return null
  }

  /**
   * Extract repository from channel name
   */
  private extractFromChannelName(channelName: string): RepositoryContext | null {
    // Channel names might follow patterns like:
    // - "project-repo-name"
    // - "team-project"
    // - "org-project-frontend"

    // This is a heuristic and should be configured per-org
    // For now, we just check if the channel name contains a repo-like pattern

    // Try to extract from channel name patterns
    const patterns = [
      // Matches patterns like "eng-opencode" -> could be "org/opencode"
      /^[a-z]+-([a-z][a-z0-9-]+)$/,
    ]

    for (const pattern of patterns) {
      const match = channelName.match(pattern)
      if (match?.[1]) {
        return {
          repository: undefined, // We don't know the org
          source: "channel_name",
          confidence: 0.3,
        }
      }
    }

    return null
  }

  /**
   * Update classification with additional context from message history
   */
  async enhanceWithHistory(
    current: RepositoryContext,
    _recentMessages: Array<{ text: string; ts: string }>,
  ): Promise<RepositoryContext> {
    // If we already have high confidence, don't bother
    if (current.confidence >= 0.8) {
      return current
    }

    // Look for repository mentions in recent messages
    for (const msg of _recentMessages) {
      const linkResult = this.extractFromGitHubLink(msg.text)
      if (linkResult) {
        return {
          ...linkResult,
          source: "history",
          confidence: Math.min(linkResult.confidence * 0.8, 0.9), // Slightly lower confidence for history
        }
      }

      const mentionResult = this.extractFromMention(msg.text)
      if (mentionResult) {
        return {
          ...mentionResult,
          source: "history",
          confidence: Math.min(mentionResult.confidence * 0.8, 0.9),
        }
      }
    }

    return current
  }
}
