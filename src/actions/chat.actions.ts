"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  markAsRead,
  searchUsers,
  addParticipants,
  getConversationParticipants,
} from "@/services/chat.service"
import { ConversationNotFound, MessageNotFound, ForbiddenError, ValidationError } from "@/lib/errors"
import { ROLE_LEVELS, type UserRole } from "@/types"
import type { CreateConversationInput, SendMessageInput } from "@/types"

async function getAuthedUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const role = (session.user.role ?? "unassigned") as UserRole
  if (ROLE_LEVELS[role] < ROLE_LEVELS.loanOfficer) return null
  return { id: session.user.id, role }
}

export async function createConversationAction(input: CreateConversationInput) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  if (!input.participantIds || input.participantIds.length === 0) {
    return { error: "At least one participant is required" }
  }

  try {
    const data = await Effect.runPromise(
      createConversation(user.id, input.participantIds, input.name)
    )
    return { data }
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function getConversationsAction() {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getConversations(user.id))
    return { data }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function getMessagesAction(conversationId: string, cursor?: string) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getMessages(conversationId, user.id, cursor))
    return { data }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    if (error instanceof ForbiddenError) return { error: "Forbidden" }
    return { error: "Internal server error" }
  }
}

export async function sendMessageAction(input: SendMessageInput) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  if (!input.content?.trim() && (!input.attachments || input.attachments.length === 0)) {
    return { error: "Message must have content or attachments" }
  }

  try {
    const data = await Effect.runPromise(
      sendMessage(
        input.conversationId,
        user.id,
        input.content ?? "",
        input.mentions ?? [],
        input.attachments ?? []
      )
    )
    return { data }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    if (error instanceof ForbiddenError) return { error: "Forbidden" }
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function deleteMessageAction(messageId: string) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(deleteMessage(messageId, user.id, user.role))
    return { data: null }
  } catch (error) {
    if (error instanceof MessageNotFound) return { error: "Message not found" }
    if (error instanceof ForbiddenError) return { error: "Forbidden" }
    return { error: "Internal server error" }
  }
}

export async function markAsReadAction(conversationId: string) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(markAsRead(conversationId, user.id))
    return { data: null }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function searchUsersAction(query: string) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  if (query.length < 2) return { data: [] }

  try {
    const data = await Effect.runPromise(searchUsers(query, user.id))
    return { data }
  } catch (error) {
    return { error: "Internal server error" }
  }
}

export async function addParticipantsAction(conversationId: string, userIds: string[]) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(addParticipants(conversationId, userIds, user.id))
    return { data: null }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    if (error instanceof ForbiddenError) return { error: "Forbidden" }
    if (error instanceof ValidationError) return { error: error.message }
    return { error: "Internal server error" }
  }
}

export async function getConversationParticipantsAction(conversationId: string) {
  const user = await getAuthedUser()
  if (!user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getConversationParticipants(conversationId))
    return { data }
  } catch (error) {
    if (error instanceof ConversationNotFound) return { error: "Conversation not found" }
    return { error: "Internal server error" }
  }
}
