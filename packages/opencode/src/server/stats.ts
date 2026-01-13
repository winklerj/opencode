import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { aggregateSessionStats } from "../cli/cmd/stats"

/**
 * Stats API Routes
 *
 * Provides endpoints for retrieving session statistics and metrics.
 */

/**
 * Token usage statistics
 */
const TokenStats = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
})

/**
 * Model usage statistics
 */
const ModelUsage = z.object({
  messages: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
  }),
  cost: z.number(),
})

/**
 * Session statistics response
 */
const SessionStats = z.object({
  totalSessions: z.number(),
  totalMessages: z.number(),
  totalCost: z.number(),
  totalTokens: TokenStats,
  toolUsage: z.record(z.string(), z.number()),
  modelUsage: z.record(z.string(), ModelUsage),
  dateRange: z.object({
    earliest: z.number(),
    latest: z.number(),
  }),
  days: z.number(),
  costPerDay: z.number(),
  tokensPerSession: z.number(),
  medianTokensPerSession: z.number(),
})

/**
 * Live metrics (subset of stats for quick access)
 */
const LiveStats = z.object({
  activeSessions: z.number(),
  totalSessions: z.number(),
  totalMessages: z.number(),
  recentCost: z.number(),
})

export const StatsRoute = new Hono()
  // GET /stats - Get dashboard statistics
  .get(
    "/",
    describeRoute({
      summary: "Get statistics",
      description:
        "Get comprehensive session statistics including token usage, costs, tool usage, and model usage.",
      operationId: "stats.get",
      responses: {
        200: {
          description: "Session statistics",
          content: {
            "application/json": {
              schema: resolver(SessionStats),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        days: z.coerce.number().optional().describe("Number of days to include (default: all time)"),
        project: z.string().optional().describe("Filter by project ID"),
      }),
    ),
    async (c) => {
      const { days, project } = c.req.valid("query")
      const stats = await aggregateSessionStats(days, project)
      return c.json(stats)
    },
  )
  // GET /stats/live - Get live metrics
  .get(
    "/live",
    describeRoute({
      summary: "Get live metrics",
      description: "Get live metrics for quick dashboard display (last 24 hours).",
      operationId: "stats.live",
      responses: {
        200: {
          description: "Live metrics",
          content: {
            "application/json": {
              schema: resolver(LiveStats),
            },
          },
        },
      },
    }),
    async (c) => {
      // Get stats for last 24 hours and last 5 minutes
      const todayStats = await aggregateSessionStats(1)
      const recentStats = await aggregateSessionStats(0) // Today only

      return c.json({
        activeSessions: recentStats.totalSessions,
        totalSessions: todayStats.totalSessions,
        totalMessages: todayStats.totalMessages,
        recentCost: todayStats.totalCost,
      })
    },
  )
  // GET /stats/historical - Get historical metrics by period
  .get(
    "/historical",
    describeRoute({
      summary: "Get historical metrics",
      description: "Get historical metrics for a specific time period.",
      operationId: "stats.historical",
      responses: {
        200: {
          description: "Historical metrics",
          content: {
            "application/json": {
              schema: resolver(SessionStats),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        period: z.enum(["day", "week", "month", "quarter"]).default("week").describe("Time period"),
        project: z.string().optional().describe("Filter by project ID"),
      }),
    ),
    async (c) => {
      const { period, project } = c.req.valid("query")

      const daysMap: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        quarter: 90,
      }

      const days = daysMap[period]
      const stats = await aggregateSessionStats(days, project)
      return c.json(stats)
    },
  )
