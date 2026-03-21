"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getWatchlistData } from "@/services/watchlist.service"
import { DatabaseError } from "@/lib/errors"

export async function getWatchlistAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getWatchlistData())
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}
