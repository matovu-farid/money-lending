import { type NextRequest } from "next/server"
import { Effect } from "effect"
import { cleanupExpiredAttachments } from "@/services/chat.service"

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const deletedCount = await Effect.runPromise(cleanupExpiredAttachments())
    return Response.json({
      deleted: deletedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Cron] Attachment cleanup failed:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
