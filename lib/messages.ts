// lib/messages.ts
// Data layer for in-app direct messages. All queries are parameterized and go
// through the engine adapter, so they run on MySQL or SQL Server. A user may
// only ever read/write conversations they are a party to — enforced here by
// always binding the caller's own id into every query.
import { appQuery, appDb } from "./db";
import { roleDescription, seesAllBranches, type Role } from "./rbac";
import { branchNamesFor } from "./branch-label";

export interface Contact {
  id: number;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  unread: number;
}

export interface Attachment {
  name: string;
  mime: string;
  size: number;
}

export interface Message {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
  attachment: Attachment | null;
}

export interface AttachmentInput {
  key: string;
  name: string;
  mime: string;
  size: number;
}

interface ContactRow {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  unread: number | null;
}

/**
 * Everyone the caller can message: all other active users EXCEPT super admins
 * (they're deliberately out of the messaging directory). Includes a per-contact
 * unread count. Branch-scoped contacts get a "{Branch} Branch Operations"
 * descriptor; admins get "Administrator".
 */
export async function listContacts(meId: number): Promise<Contact[]> {
  const rows = await appQuery<ContactRow>(
    `SELECT u.id, u.full_name, u.email, u.role,
            (SELECT COUNT(*) FROM app_messages m
              WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
       FROM app_users u
      WHERE u.id <> ? AND u.is_active = 1 AND u.role <> 'SUPER_ADMIN'
      ORDER BY u.full_name`,
    [meId, meId],
  );

  // Resolve branch names for the branch-scoped contacts in one shot.
  const scopedIds = rows.filter((r) => !seesAllBranches(r.role)).map((r) => Number(r.id));
  const branchesByUser = new Map<number, string[]>();
  if (scopedIds.length) {
    const ph = scopedIds.map(() => "?").join(", ");
    const brows = await appQuery<{ user_id: number; branch_id: string }>(
      `SELECT user_id, branch_id FROM app_user_branches WHERE user_id IN (${ph})`,
      scopedIds,
    );
    for (const b of brows) {
      const list = branchesByUser.get(Number(b.user_id)) ?? [];
      list.push(b.branch_id);
      branchesByUser.set(Number(b.user_id), list);
    }
  }

  return Promise.all(
    rows.map(async (r) => {
      const branchName = seesAllBranches(r.role)
        ? null
        : await branchNamesFor(branchesByUser.get(Number(r.id)) ?? []);
      return {
        id: Number(r.id),
        name: r.full_name,
        email: r.email,
        role: r.role,
        roleLabel: roleDescription(r.role, branchName) ?? r.role,
        unread: Number(r.unread ?? 0),
      };
    }),
  );
}

interface MessageRow {
  id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  created_at: string | Date;
  edited_at: string | Date | null;
}

function mapMessage(r: MessageRow, meId: number): Message {
  return {
    id: Number(r.id),
    senderId: Number(r.sender_id),
    recipientId: Number(r.recipient_id),
    body: r.body,
    createdAt: new Date(r.created_at as string).toISOString(),
    editedAt: r.edited_at ? new Date(r.edited_at as string).toISOString() : null,
    mine: Number(r.sender_id) === meId,
    attachment: r.attachment_key
      ? { name: r.attachment_name ?? "attachment", mime: r.attachment_mime ?? "application/octet-stream", size: Number(r.attachment_size ?? 0) }
      : null,
  };
}

const MSG_COLS =
  "id, sender_id, recipient_id, body, attachment_key, attachment_name, attachment_mime, attachment_size, created_at, edited_at";

/** The conversation between the caller and `otherId`, oldest first. */
export async function getConversation(meId: number, otherId: number): Promise<Message[]> {
  const rows = await appQuery<MessageRow>(
    `SELECT ${MSG_COLS}
       FROM app_messages
      WHERE (sender_id = ? AND recipient_id = ?)
         OR (sender_id = ? AND recipient_id = ?)
      ORDER BY id ASC`,
    [meId, otherId, otherId, meId],
  );
  return rows.map((r) => mapMessage(r, meId));
}

/** The attachment key + names for one message the caller is a party to (for download). */
export async function getMessageAttachment(
  meId: number,
  messageId: number,
): Promise<{ key: string; name: string; mime: string } | null> {
  const rows = await appQuery<MessageRow>(
    `SELECT ${MSG_COLS} FROM app_messages
      WHERE id = ? AND (sender_id = ? OR recipient_id = ?)`,
    [messageId, meId, meId],
  );
  const r = rows[0];
  if (!r || !r.attachment_key) return null;
  return { key: r.attachment_key, name: r.attachment_name ?? "attachment", mime: r.attachment_mime ?? "application/octet-stream" };
}

/** Mark every message `otherId` sent to the caller as read. */
export async function markRead(meId: number, otherId: number): Promise<void> {
  const now = appDb().dialect === "mssql" ? "GETDATE()" : "NOW()";
  await appQuery(
    `UPDATE app_messages SET read_at = ${now}
      WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`,
    [meId, otherId],
  );
}

interface ExistsRow {
  id: number;
}

/** Send a message. A message must carry text, an attachment, or both. */
export async function sendMessage(
  meId: number,
  recipientId: number,
  body: string,
  attachment?: AttachmentInput | null,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed && !attachment) throw new Error("Message is empty.");
  if (trimmed.length > 4000) throw new Error("Message is too long.");
  if (recipientId === meId) throw new Error("Cannot message yourself.");

  // Super admins are out of the messaging directory — never a valid recipient.
  const recipient =
    appDb().dialect === "mssql"
      ? await appQuery<ExistsRow>("SELECT TOP 1 id FROM app_users WHERE id = ? AND is_active = 1 AND role <> 'SUPER_ADMIN'", [recipientId])
      : await appQuery<ExistsRow>("SELECT id FROM app_users WHERE id = ? AND is_active = 1 AND role <> 'SUPER_ADMIN' LIMIT 1", [recipientId]);
  if (recipient.length === 0) throw new Error("Recipient not found.");

  await appQuery(
    `INSERT INTO app_messages
       (sender_id, recipient_id, body, attachment_key, attachment_name, attachment_mime, attachment_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      meId, recipientId, trimmed,
      attachment?.key ?? null, attachment?.name ?? null,
      attachment?.mime ?? null, attachment?.size ?? null,
    ],
  );
}

/** Edit the text of one of the caller's OWN messages. Marks it edited. */
export async function editMessage(meId: number, messageId: number, body: string): Promise<boolean> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message text is empty.");
  if (trimmed.length > 4000) throw new Error("Message is too long.");
  const owned = await appQuery<ExistsRow>(
    "SELECT id FROM app_messages WHERE id = ? AND sender_id = ?",
    [messageId, meId],
  );
  if (owned.length === 0) return false;
  const now = appDb().dialect === "mssql" ? "SYSUTCDATETIME()" : "NOW()";
  await appQuery(
    `UPDATE app_messages SET body = ?, edited_at = ${now} WHERE id = ? AND sender_id = ?`,
    [trimmed, messageId, meId],
  );
  return true;
}

/**
 * Delete one or more of the caller's OWN messages. Returns the attachment keys
 * of the deleted rows so the caller can remove the backing files.
 */
export async function deleteMessages(meId: number, ids: number[]): Promise<string[]> {
  const clean = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return [];
  const placeholders = clean.map(() => "?").join(", ");
  const rows = await appQuery<{ attachment_key: string | null }>(
    `SELECT attachment_key FROM app_messages
      WHERE sender_id = ? AND id IN (${placeholders})`,
    [meId, ...clean],
  );
  await appQuery(
    `DELETE FROM app_messages WHERE sender_id = ? AND id IN (${placeholders})`,
    [meId, ...clean],
  );
  return rows.map((r) => r.attachment_key).filter((k): k is string => !!k);
}

export interface UnreadPreview {
  messageId: number;
  senderId: number;
  senderName: string;
  roleLabel: string;
  preview: string;
  hasAttachment: boolean;
  createdAt: string;
}

interface UnreadRow {
  id: number;
  sender_id: number;
  full_name: string;
  role: Role;
  body: string;
  attachment_key: string | null;
  attachment_name: string | null;
  created_at: string | Date;
}

/** Total unread + the most recent unread messages, for the app-wide notifier. */
export async function getUnreadSummary(
  meId: number,
): Promise<{ total: number; latest: UnreadPreview[] }> {
  const totalRows = await appQuery<{ n: number }>(
    "SELECT COUNT(*) AS n FROM app_messages WHERE recipient_id = ? AND read_at IS NULL",
    [meId],
  );
  const total = Number(totalRows[0]?.n ?? 0);

  const latestRows =
    appDb().dialect === "mssql"
      ? await appQuery<UnreadRow>(
          `SELECT TOP 8 m.id, m.sender_id, u.full_name, u.role, m.body, m.attachment_key, m.attachment_name, m.created_at
             FROM app_messages m JOIN app_users u ON u.id = m.sender_id
            WHERE m.recipient_id = ? AND m.read_at IS NULL
            ORDER BY m.id DESC`,
          [meId],
        )
      : await appQuery<UnreadRow>(
          `SELECT m.id, m.sender_id, u.full_name, u.role, m.body, m.attachment_key, m.attachment_name, m.created_at
             FROM app_messages m JOIN app_users u ON u.id = m.sender_id
            WHERE m.recipient_id = ? AND m.read_at IS NULL
            ORDER BY m.id DESC LIMIT 8`,
          [meId],
        );

  const latest: UnreadPreview[] = latestRows.map((r) => ({
    messageId: Number(r.id),
    senderId: Number(r.sender_id),
    senderName: r.full_name,
    roleLabel: roleDescription(r.role, null) ?? r.role,
    preview: r.body?.trim()
      ? r.body.trim().slice(0, 140)
      : r.attachment_key
        ? `📎 ${r.attachment_name ?? "Attachment"}`
        : "",
    hasAttachment: !!r.attachment_key,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
  return { total, latest };
}
