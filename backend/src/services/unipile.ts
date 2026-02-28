import { readFileSync } from "fs";
import { basename } from "path";

const baseUrl = process.env.UNIPILE_DSN || "";
const apiKey = process.env.UNIPILE_API_KEY || "";

async function request(method: string, path: string, body?: unknown) {
  const url = `${baseUrl}/api/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-API-KEY": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Unipile API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Accounts ────────────────────────────────────────────────

export async function listAllUnipileAccounts() {
  return request("GET", "/accounts");
}

export async function deleteUnipileAccount(accountId: string) {
  return request("DELETE", `/accounts/${accountId}`);
}

export async function getHostedAuthLink(type: string) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  return request("POST", "/hosted/accounts/link", {
    type: "create",
    providers: [type.toUpperCase()],
    api_url: baseUrl,
    success_redirect_url: `${frontendUrl}/settings`,
    expiresOn: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

// ─── Chats ───────────────────────────────────────────────────

export async function listAllChats(accountType?: string) {
  const allItems: unknown[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    if (accountType) params.set("account_type", accountType.toUpperCase());

    const data = await request("GET", `/chats?${params}`);
    const items = (data as { items?: unknown[]; cursor?: string }).items || [];
    allItems.push(...items);
    cursor = (data as { cursor?: string }).cursor || undefined;
  } while (cursor);

  if (accountType?.toUpperCase() === "LINKEDIN") {
    await enrichChatsWithAttendees(allItems as Record<string, unknown>[]);
  }

  return { items: allItems };
}

async function enrichChatsWithAttendees(chats: Record<string, unknown>[]) {
  const BATCH_SIZE = 10;
  for (let i = 0; i < chats.length; i += BATCH_SIZE) {
    const batch = chats.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (chat) => {
        try {
          const data = await request("GET", `/chats/${chat.id}/attendees`);
          chat.attendees = Array.isArray(data) ? data : (data as { items?: unknown[] }).items || [];
        } catch {
          // skip
        }
      })
    );
  }
}

// ─── Email ───────────────────────────────────────────────────

export async function sendEmail(params: {
  accountId: string;
  to: { display_name: string; identifier: string }[];
  subject: string;
  body: string;
  attachmentPaths?: string[];
}) {
  const form = new FormData();
  form.append("account_id", params.accountId);
  form.append("to", JSON.stringify(params.to));
  form.append("subject", params.subject);
  form.append("body", params.body);

  if (params.attachmentPaths?.length) {
    for (const filePath of params.attachmentPaths) {
      const buffer = readFileSync(filePath);
      const blob = new Blob([buffer]);
      form.append("attachments", blob, basename(filePath));
    }
  }

  const res = await fetch(`${baseUrl}/api/v1/emails`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Unipile send email failed: ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── WhatsApp / LinkedIn messages ────────────────────────────

export async function sendChatMessage(
  chatId: string,
  text: string,
  attachmentPaths?: string[]
) {
  const form = new FormData();
  form.append("text", text);

  if (attachmentPaths?.length) {
    for (const filePath of attachmentPaths) {
      const buffer = readFileSync(filePath);
      const blob = new Blob([buffer]);
      form.append("attachments", blob, basename(filePath));
    }
  }

  const res = await fetch(`${baseUrl}/api/v1/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Unipile send message failed: ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── LinkedIn-specific ──────────────────────────────────────

export async function linkedinSearch(
  accountId: string,
  params: Record<string, unknown>
) {
  return request(
    "POST",
    `/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
    params
  );
}

export async function linkedinGetSearchParams(
  accountId: string,
  type: string,
  keywords?: string
) {
  const qs = new URLSearchParams({
    account_id: accountId,
    type,
  });
  if (keywords) qs.set("keywords", keywords);
  return request("GET", `/linkedin/search/parameters?${qs}`);
}

export async function linkedinGetProfile(accountId: string, profileId: string) {
  return request(
    "GET",
    `/users/${encodeURIComponent(profileId)}?account_id=${encodeURIComponent(accountId)}`
  );
}

export async function linkedinSendInvite(
  accountId: string,
  providerId: string,
  message?: string
) {
  return request("POST", `/users/invite`, {
    account_id: accountId,
    provider_id: providerId,
    message,
  });
}

export async function linkedinCreatePost(accountId: string, text: string) {
  const form = new FormData();
  form.append("account_id", accountId);
  form.append("text", text);

  const res = await fetch(`${baseUrl}/api/v1/posts`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Unipile create post failed: ${res.status}: ${errText}`);
  }
  return res.json();
}

export async function linkedinListPosts(accountId: string) {
  return request("GET", `/posts?account_id=${encodeURIComponent(accountId)}`);
}
