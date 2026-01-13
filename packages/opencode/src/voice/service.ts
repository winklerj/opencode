import z from "zod"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

/**
 * Voice Service
 *
 * Manages voice recognition sessions for OpenCode sessions.
 * Handles start/stop, status tracking, and audio processing.
 */
export namespace VoiceService {
  const log = Log.create({ service: "voice" })

  /**
   * Voice session status
   */
  export const Status = z.enum(["idle", "listening", "processing", "error"])
  export type Status = z.infer<typeof Status>

  /**
   * Voice session info
   */
  export const VoiceSession = z.object({
    sessionID: z.string(),
    status: Status,
    language: z.string().default("en-US"),
    startedAt: z.number().optional(),
    lastActivityAt: z.number().optional(),
    error: z.string().optional(),
  })
  export type VoiceSession = z.infer<typeof VoiceSession>

  /**
   * Configuration for voice recognition
   */
  export const VoiceConfig = z.object({
    language: z.string().default("en-US"),
    continuous: z.boolean().default(true),
    interimResults: z.boolean().default(true),
    commitDelay: z.number().default(250),
  })
  export type VoiceConfig = z.infer<typeof VoiceConfig>

  /**
   * Result from processing voice audio
   */
  export const TranscriptResult = z.object({
    text: z.string(),
    isFinal: z.boolean(),
    confidence: z.number(),
    language: z.string().optional(),
  })
  export type TranscriptResult = z.infer<typeof TranscriptResult>

  // Events
  export const Event = {
    Started: BusEvent.define(
      "voice.started",
      z.object({
        sessionID: z.string(),
      }),
    ),
    Stopped: BusEvent.define(
      "voice.stopped",
      z.object({
        sessionID: z.string(),
      }),
    ),
    Transcribed: BusEvent.define(
      "voice.transcribed",
      z.object({
        sessionID: z.string(),
        transcript: TranscriptResult,
      }),
    ),
    Error: BusEvent.define(
      "voice.error",
      z.object({
        sessionID: z.string(),
        error: z.string(),
      }),
    ),
  }

  // Errors
  export const AlreadyActiveError = NamedError.create(
    "VoiceAlreadyActiveError",
    z.object({
      sessionID: z.string(),
    }),
  )

  export const NotActiveError = NamedError.create(
    "VoiceNotActiveError",
    z.object({
      sessionID: z.string(),
    }),
  )

  export const ProcessingError = NamedError.create(
    "VoiceProcessingError",
    z.object({
      sessionID: z.string(),
      message: z.string(),
    }),
  )

  // In-memory state for voice sessions
  const voiceSessions = new Map<string, VoiceSession>()

  /**
   * Start voice recognition for a session
   */
  export async function start(sessionID: string, config?: Partial<VoiceConfig>): Promise<VoiceSession> {
    log.info("starting voice recognition", { sessionID })

    const existing = voiceSessions.get(sessionID)
    if (existing && existing.status === "listening") {
      throw new AlreadyActiveError({ sessionID })
    }

    const voiceSession: VoiceSession = {
      sessionID,
      status: "listening",
      language: config?.language ?? "en-US",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    }

    voiceSessions.set(sessionID, voiceSession)

    await Bus.publish(Event.Started, { sessionID })
    log.info("voice recognition started", { sessionID })

    return voiceSession
  }

  /**
   * Stop voice recognition for a session
   */
  export async function stop(sessionID: string): Promise<VoiceSession> {
    log.info("stopping voice recognition", { sessionID })

    const session = voiceSessions.get(sessionID)
    if (!session || session.status === "idle") {
      throw new NotActiveError({ sessionID })
    }

    session.status = "idle"
    session.lastActivityAt = Date.now()

    await Bus.publish(Event.Stopped, { sessionID })
    log.info("voice recognition stopped", { sessionID })

    return session
  }

  /**
   * Get voice recognition status for a session
   */
  export function getStatus(sessionID: string): VoiceSession {
    const session = voiceSessions.get(sessionID)
    if (!session) {
      return {
        sessionID,
        status: "idle",
        language: "en-US",
      }
    }
    return session
  }

  /**
   * Process voice audio and return transcript
   *
   * This accepts base64-encoded audio data and processes it.
   * In production, this would integrate with a speech-to-text service.
   */
  export async function processAudio(
    sessionID: string,
    audioData: string,
    mimeType: string = "audio/webm",
  ): Promise<TranscriptResult> {
    log.info("processing voice audio", { sessionID, mimeType, dataLength: audioData.length })

    const session = voiceSessions.get(sessionID)

    // Update activity timestamp
    if (session) {
      session.lastActivityAt = Date.now()
      session.status = "processing"
    }

    try {
      // Decode base64 audio
      const audioBuffer = Buffer.from(audioData, "base64")

      // In production, this would send to a speech-to-text service (e.g., Whisper, Google Speech, etc.)
      // For now, we return a placeholder result indicating the audio was received
      const result: TranscriptResult = {
        text: "", // Would be filled by actual transcription
        isFinal: false,
        confidence: 0,
        language: session?.language ?? "en-US",
      }

      // In production implementation:
      // const result = await transcribeAudio(audioBuffer, mimeType, session?.language)

      if (session) {
        session.status = "listening"
      }

      await Bus.publish(Event.Transcribed, { sessionID, transcript: result })

      log.info("voice audio processed", {
        sessionID,
        textLength: result.text.length,
        isFinal: result.isFinal,
        confidence: result.confidence,
      })

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"

      if (session) {
        session.status = "error"
        session.error = message
      }

      await Bus.publish(Event.Error, { sessionID, error: message })

      throw new ProcessingError({ sessionID, message })
    }
  }

  /**
   * Send a voice prompt (audio -> transcript -> prompt)
   *
   * This is a convenience method that processes audio and,
   * if the transcript is final and meets confidence threshold,
   * returns it ready to be sent as a prompt.
   */
  export async function sendVoicePrompt(
    sessionID: string,
    audioData: string,
    mimeType: string = "audio/webm",
    confidenceThreshold: number = 0.5,
  ): Promise<{ transcript: TranscriptResult; shouldSend: boolean }> {
    const result = await processAudio(sessionID, audioData, mimeType)

    const shouldSend = result.isFinal && result.confidence >= confidenceThreshold && result.text.trim().length > 0

    return {
      transcript: result,
      shouldSend,
    }
  }

  /**
   * Clean up voice session
   */
  export function cleanup(sessionID: string): void {
    voiceSessions.delete(sessionID)
    log.info("voice session cleaned up", { sessionID })
  }

  /**
   * Get all active voice sessions
   */
  export function listActive(): VoiceSession[] {
    return Array.from(voiceSessions.values()).filter((s) => s.status !== "idle")
  }
}
