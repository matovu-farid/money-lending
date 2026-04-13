-- Drop chat-related tables (message_attachments → messages → conversation_participants → conversations)
DROP TABLE IF EXISTS "message_attachments" CASCADE;
DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "conversation_participants" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;
