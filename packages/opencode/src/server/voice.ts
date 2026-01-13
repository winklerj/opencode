import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { VoiceService } from "../voice/service"
import z from "zod"
import { errors } from "./error"

/**
 * Voice API Routes
 *
 * Implements the Voice API from the specification:
 * - POST   /session/:sessionID/voice/start    Start voice recognition
 * - POST   /session/:sessionID/voice/stop     Stop voice recognition
 * - GET    /session/:sessionID/voice/status   Get voice recognition status
 * - POST   /session/:sessionID/voice          Send voice prompt (base64 audio)
 */
export const VoiceRoute = new Hono()
  // POST /voice/start - Start voice recognition
  .post(
    "/start",
    describeRoute({
      summary: "Start voice recognition",
      description: "Start voice recognition for a session. Voice input will be transcribed and can be sent as prompts.",
      operationId: "voice.start",
      responses: {
        200: {
          description: "Voice recognition started",
          content: {
            "application/json": {
              schema: resolver(VoiceService.VoiceSession),
            },
          },
        },
        ...errors(400, 409),
      },
    }),
    validator(
      "json",
      z
        .object({
          language: z.string().optional().describe("Language code for recognition (e.g., 'en-US')"),
          continuous: z.boolean().optional().describe("Whether to use continuous recognition"),
          interimResults: z.boolean().optional().describe("Whether to return interim results"),
        })
        .optional(),
    ),
    async (c) => {
      const sessionID = c.req.param("sessionID")
      if (!sessionID) {
        return c.json({ error: "Session ID is required" }, 400)
      }

      const body = c.req.valid("json")

      try {
        const session = await VoiceService.start(sessionID, body)
        return c.json(session)
      } catch (error) {
        if (error instanceof VoiceService.AlreadyActiveError) {
          return c.json({ error: "Voice recognition is already active for this session" }, 409)
        }
        throw error
      }
    },
  )
  // POST /voice/stop - Stop voice recognition
  .post(
    "/stop",
    describeRoute({
      summary: "Stop voice recognition",
      description: "Stop voice recognition for a session.",
      operationId: "voice.stop",
      responses: {
        200: {
          description: "Voice recognition stopped",
          content: {
            "application/json": {
              schema: resolver(VoiceService.VoiceSession),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    async (c) => {
      const sessionID = c.req.param("sessionID")
      if (!sessionID) {
        return c.json({ error: "Session ID is required" }, 400)
      }

      try {
        const session = await VoiceService.stop(sessionID)
        return c.json(session)
      } catch (error) {
        if (error instanceof VoiceService.NotActiveError) {
          return c.json({ error: "Voice recognition is not active for this session" }, 404)
        }
        throw error
      }
    },
  )
  // GET /voice/status - Get voice recognition status
  .get(
    "/status",
    describeRoute({
      summary: "Get voice status",
      description: "Get the current voice recognition status for a session.",
      operationId: "voice.status",
      responses: {
        200: {
          description: "Voice recognition status",
          content: {
            "application/json": {
              schema: resolver(VoiceService.VoiceSession),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const sessionID = c.req.param("sessionID")
      if (!sessionID) {
        return c.json({ error: "Session ID is required" }, 400)
      }

      const status = VoiceService.getStatus(sessionID)
      return c.json(status)
    },
  )
  // POST /voice - Send voice prompt (base64 audio)
  .post(
    "/",
    describeRoute({
      summary: "Send voice prompt",
      description:
        "Send voice audio data (base64 encoded) to be transcribed and optionally sent as a prompt to the session.",
      operationId: "voice.send",
      responses: {
        200: {
          description: "Voice prompt processed",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  transcript: VoiceService.TranscriptResult,
                  shouldSend: z.boolean().describe("Whether the transcript meets criteria to be sent as a prompt"),
                }),
              ),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator(
      "json",
      z.object({
        audio: z.string().describe("Base64-encoded audio data"),
        mimeType: z.string().optional().describe("MIME type of the audio (default: audio/webm)"),
        confidenceThreshold: z.number().optional().describe("Minimum confidence to auto-send (default: 0.5)"),
      }),
    ),
    async (c) => {
      const sessionID = c.req.param("sessionID")
      if (!sessionID) {
        return c.json({ error: "Session ID is required" }, 400)
      }

      const { audio, mimeType, confidenceThreshold } = c.req.valid("json")

      try {
        const result = await VoiceService.sendVoicePrompt(sessionID, audio, mimeType, confidenceThreshold)
        return c.json(result)
      } catch (error) {
        if (error instanceof VoiceService.ProcessingError) {
          return c.json({ error: error.data.message }, 500)
        }
        throw error
      }
    },
  )
