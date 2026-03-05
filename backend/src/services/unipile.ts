import { readFileSync } from "fs";
import { basename } from "path";
import type { LifecycleAware, ChannelProtocol } from "../core/types";
import { AsyncResult } from "../core/monad";
import { TelemetryCollector } from "../core/monad";

interface ChannelGatewayConfiguration {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly frontendUrl: string;
  readonly backendUrl: string;
  readonly requestTimeoutMs: number;
}

interface TransportDescriptor {
  method: string;
  path: string;
  body?: unknown;
  contentType?: string;
}

type GatewayResponse<T = unknown> = {
  data: T;
  status: number;
  latencyMs: number;
};

const resolveGatewayConfiguration = (): ChannelGatewayConfiguration => ({
  baseUrl: process.env.UNIPILE_DSN || "",
  apiKey: process.env.UNIPILE_API_KEY || "",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  backendUrl: process.env.BACKEND_URL || "http://localhost:3001",
  requestTimeoutMs: 30_000,
});

class ExternalChannelGateway implements LifecycleAware {
  private readonly config: ChannelGatewayConfiguration;
  private readonly telemetry: TelemetryCollector;

  constructor(config?: ChannelGatewayConfiguration) {
    this.config = config ?? resolveGatewayConfiguration();
    this.telemetry = TelemetryCollector.shared();
  }

  onInitialize(): void {
    this.telemetry.record("gateway.initialized", "channel-gateway", {
      baseUrl: this.config.baseUrl ? "[configured]" : "[missing]",
    });
  }

  private constructEndpoint(path: string): string {
    return `${this.config.baseUrl}/api/v1${path}`;
  }

  private buildAuthHeaders(
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    return {
      "X-API-KEY": this.config.apiKey,
      ...additionalHeaders,
    };
  }

  private async executeTransport<T = unknown>(
    descriptor: TransportDescriptor,
  ): Promise<T> {
    const url = this.constructEndpoint(descriptor.path);
    const startTime = Date.now();

    const headers: Record<string, string> = this.buildAuthHeaders(
      descriptor.body && descriptor.contentType !== "multipart"
        ? { "Content-Type": "application/json" }
        : undefined,
    );

    const res = await fetch(url, {
      method: descriptor.method,
      headers,
      body: descriptor.body
        ? descriptor.contentType === "multipart"
          ? undefined
          : JSON.stringify(descriptor.body)
        : undefined,
    });

    const latencyMs = Date.now() - startTime;
    this.telemetry.record("gateway.request", descriptor.path, {
      method: descriptor.method,
      status: res.status,
      latencyMs,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Unipile API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async executeFormTransport<T = unknown>(
    method: string,
    path: string,
    form: FormData,
  ): Promise<T> {
    const url = this.constructEndpoint(path);

    const res = await fetch(url, {
      method,
      headers: { "X-API-KEY": this.config.apiKey },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Unipile API error ${res.status}: ${text}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private attachFilesToForm(
    form: FormData,
    attachmentPaths: string[],
    fieldName = "attachments",
  ): void {
    for (const filePath of attachmentPaths) {
      const buffer = readFileSync(filePath);
      const blob = new Blob([buffer]);
      form.append(fieldName, blob, basename(filePath));
    }
  }

  liftTransport<T = unknown>(
    descriptor: TransportDescriptor,
  ): AsyncResult<T> {
    return AsyncResult.from(
      () => this.executeTransport<T>(descriptor),
      `transport.${descriptor.method}.${descriptor.path}`,
    );
  }

  async listAllUnipileAccounts() {
    return this.executeTransport({ method: "GET", path: "/accounts" });
  }

  async getUnipileAccount(accountId: string) {
    return this.executeTransport<Record<string, unknown>>({
      method: "GET",
      path: `/accounts/${encodeURIComponent(accountId)}`,
    });
  }

  async deleteUnipileAccount(accountId: string) {
    return this.executeTransport({
      method: "DELETE",
      path: `/accounts/${accountId}`,
    });
  }

  async getHostedAuthLink(type: string, orgId?: number) {
    const body: Record<string, unknown> = {
      type: "create",
      providers: [type.toUpperCase()],
      api_url: this.config.baseUrl,
      success_redirect_url: `${this.config.frontendUrl}/settings?unipile_connected=1`,
      expiresOn: new Date(Date.now() + 3_600_000).toISOString(),
    };

    if (orgId != null) {
      body.notify_url = `${this.config.backendUrl}/api/unipile/notify`;
      body.name = String(orgId);
    }

    return this.executeTransport({
      method: "POST",
      path: "/hosted/accounts/link",
      body,
    });
  }

  async listAllChats(accountType?: string) {
    const aggregatedItems: unknown[] = [];
    let paginationCursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: "100" });
      if (paginationCursor) params.set("cursor", paginationCursor);
      if (accountType)
        params.set("account_type", accountType.toUpperCase());

      const data = await this.executeTransport<{
        items?: unknown[];
        cursor?: string;
      }>({
        method: "GET",
        path: `/chats?${params}`,
      });

      const items = data.items || [];
      aggregatedItems.push(...items);
      paginationCursor = data.cursor || undefined;
    } while (paginationCursor);

    if (accountType?.toUpperCase() === "LINKEDIN") {
      await this.enrichChatsWithAttendeeGraph(
        aggregatedItems as Record<string, unknown>[],
      );
    }

    return { items: aggregatedItems };
  }

  private async enrichChatsWithAttendeeGraph(
    chats: Record<string, unknown>[],
  ): Promise<void> {
    const CONCURRENCY_LIMIT = 10;
    for (let i = 0; i < chats.length; i += CONCURRENCY_LIMIT) {
      const batch = chats.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.allSettled(
        batch.map(async (chat) => {
          try {
            const data = await this.executeTransport<
              unknown[] | { items?: unknown[] }
            >({
              method: "GET",
              path: `/chats/${chat.id}/attendees`,
            });
            chat.attendees = Array.isArray(data)
              ? data
              : (data as { items?: unknown[] }).items || [];
          } catch {
            // attendee enrichment is best-effort
          }
        }),
      );
    }
  }

  async sendEmail(params: {
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
      this.attachFilesToForm(form, params.attachmentPaths);
    }

    return this.executeFormTransport("POST", "/emails", form);
  }

  async listEmails(params: {
    accountId: string;
    limit?: number;
    cursor?: string;
    folder?: string;
    from?: string;
    to?: string;
    any_email?: string;
    before?: string;
    after?: string;
  }) {
    const querySegments = new URLSearchParams();
    querySegments.set("account_id", params.accountId);

    const optionalFields: Array<[string, string | number | undefined]> = [
      ["limit", params.limit ? String(params.limit) : undefined],
      ["cursor", params.cursor],
      ["folder", params.folder],
      ["from", params.from],
      ["to", params.to],
      ["any_email", params.any_email],
      ["before", params.before],
      ["after", params.after],
    ];

    for (const [key, value] of optionalFields) {
      if (value !== undefined) querySegments.set(key, String(value));
    }

    return this.executeTransport({
      method: "GET",
      path: `/emails?${querySegments}`,
    });
  }

  async getEmail(emailId: string) {
    return this.executeTransport({
      method: "GET",
      path: `/emails/${encodeURIComponent(emailId)}`,
    });
  }

  async listEmailFolders(accountId: string) {
    return this.executeTransport({
      method: "GET",
      path: `/email_folders?account_id=${encodeURIComponent(accountId)}`,
    });
  }

  async replyToEmail(params: {
    accountId: string;
    emailId: string;
    body: string;
    attachmentPaths?: string[];
  }) {
    const form = new FormData();
    form.append("account_id", params.accountId);
    form.append("body", params.body);
    form.append("reply_to", params.emailId);

    if (params.attachmentPaths?.length) {
      this.attachFilesToForm(form, params.attachmentPaths);
    }

    return this.executeFormTransport("POST", "/emails", form);
  }

  async deleteEmail(emailId: string) {
    return this.executeTransport({
      method: "DELETE",
      path: `/emails/${encodeURIComponent(emailId)}`,
    });
  }

  async updateEmail(
    emailId: string,
    updates: { unread?: boolean; starred?: boolean; folders?: string[] },
  ) {
    return this.executeTransport({
      method: "PUT",
      path: `/emails/${encodeURIComponent(emailId)}`,
      body: updates,
    });
  }

  async sendChatMessage(
    chatId: string,
    text: string,
    attachmentPaths?: string[],
  ) {
    const form = new FormData();
    form.append("text", text);

    if (attachmentPaths?.length) {
      this.attachFilesToForm(form, attachmentPaths);
    }

    return this.executeFormTransport(
      "POST",
      `/chats/${chatId}/messages`,
      form,
    );
  }

  async startNewChat(
    accountId: string,
    attendeeProviderId: string,
    text: string,
    attachmentPaths?: string[],
  ) {
    const form = new FormData();
    form.append("account_id", accountId);
    form.append("attendees_ids", attendeeProviderId);
    form.append("text", text);

    if (attachmentPaths?.length) {
      this.attachFilesToForm(form, attachmentPaths);
    }

    return this.executeFormTransport("POST", "/chats", form);
  }

  async findChatByAttendee(
    attendeeProviderId: string,
    accountId?: string,
  ): Promise<string | null> {
    try {
      const qs = new URLSearchParams();
      if (accountId) qs.set("account_id", accountId);
      const suffix = qs.toString() ? `?${qs}` : "";
      const data = await this.executeTransport<
        { items?: { id: string }[] } | { id: string }[]
      >({
        method: "GET",
        path: `/chat_attendees/${encodeURIComponent(attendeeProviderId)}/chats${suffix}`,
      });
      const chats = Array.isArray(data) ? data : data.items || [];
      return chats.length > 0 ? chats[0].id : null;
    } catch {
      return null;
    }
  }

  async sendMessageToUser(
    accountId: string,
    attendeeProviderId: string,
    text: string,
    attachmentPaths?: string[],
  ) {
    const existingChatId = await this.findChatByAttendee(
      attendeeProviderId,
      accountId,
    );
    if (existingChatId) {
      return this.sendChatMessage(existingChatId, text, attachmentPaths);
    }
    return this.startNewChat(accountId, attendeeProviderId, text, attachmentPaths);
  }

  async linkedinSearch(
    accountId: string,
    params: Record<string, unknown>,
  ) {
    return this.executeTransport({
      method: "POST",
      path: `/linkedin/search?account_id=${encodeURIComponent(accountId)}`,
      body: params,
    });
  }

  async linkedinGetSearchParams(
    accountId: string,
    type: string,
    keywords?: string,
  ) {
    const qs = new URLSearchParams({ account_id: accountId, type });
    if (keywords) qs.set("keywords", keywords);
    return this.executeTransport({
      method: "GET",
      path: `/linkedin/search/parameters?${qs}`,
    });
  }

  async linkedinGetProfile(accountId: string, profileId: string) {
    return this.executeTransport<Record<string, any>>({
      method: "GET",
      path: `/users/${encodeURIComponent(profileId)}?account_id=${encodeURIComponent(accountId)}`,
    });
  }

  async linkedinSendInvite(
    accountId: string,
    providerId: string,
    message?: string,
  ) {
    return this.executeTransport({
      method: "POST",
      path: `/users/invite`,
      body: { account_id: accountId, provider_id: providerId, message },
    });
  }

  async linkedinCreatePost(accountId: string, text: string) {
    const form = new FormData();
    form.append("account_id", accountId);
    form.append("text", text);
    return this.executeFormTransport("POST", "/posts", form);
  }

  async linkedinListPosts(accountId: string) {
    return this.executeTransport({
      method: "GET",
      path: `/posts?account_id=${encodeURIComponent(accountId)}`,
    });
  }
}

const channelGatewayInstance = new ExternalChannelGateway();

export const listAllUnipileAccounts = () =>
  channelGatewayInstance.listAllUnipileAccounts();
export const getUnipileAccount = (accountId: string) =>
  channelGatewayInstance.getUnipileAccount(accountId);
export const deleteUnipileAccount = (accountId: string) =>
  channelGatewayInstance.deleteUnipileAccount(accountId);
export const getHostedAuthLink = (type: string, orgId?: number) =>
  channelGatewayInstance.getHostedAuthLink(type, orgId);
export const listAllChats = (accountType?: string) =>
  channelGatewayInstance.listAllChats(accountType);
export const sendEmail = (params: Parameters<ExternalChannelGateway["sendEmail"]>[0]) =>
  channelGatewayInstance.sendEmail(params);
export const listEmails = (params: Parameters<ExternalChannelGateway["listEmails"]>[0]) =>
  channelGatewayInstance.listEmails(params);
export const getEmail = (emailId: string) =>
  channelGatewayInstance.getEmail(emailId);
export const listEmailFolders = (accountId: string) =>
  channelGatewayInstance.listEmailFolders(accountId);
export const replyToEmail = (params: Parameters<ExternalChannelGateway["replyToEmail"]>[0]) =>
  channelGatewayInstance.replyToEmail(params);
export const deleteEmail = (emailId: string) =>
  channelGatewayInstance.deleteEmail(emailId);
export const updateEmail = (
  emailId: string,
  updates: { unread?: boolean; starred?: boolean; folders?: string[] },
) => channelGatewayInstance.updateEmail(emailId, updates);
export const sendChatMessage = (
  chatId: string,
  text: string,
  attachmentPaths?: string[],
) => channelGatewayInstance.sendChatMessage(chatId, text, attachmentPaths);
export const startNewChat = (
  accountId: string,
  attendeeProviderId: string,
  text: string,
  attachmentPaths?: string[],
) =>
  channelGatewayInstance.startNewChat(
    accountId,
    attendeeProviderId,
    text,
    attachmentPaths,
  );
export const findChatByAttendee = (
  attendeeProviderId: string,
  accountId?: string,
) => channelGatewayInstance.findChatByAttendee(attendeeProviderId, accountId);
export const sendMessageToUser = (
  accountId: string,
  attendeeProviderId: string,
  text: string,
  attachmentPaths?: string[],
) =>
  channelGatewayInstance.sendMessageToUser(
    accountId,
    attendeeProviderId,
    text,
    attachmentPaths,
  );
export const linkedinSearch = (
  accountId: string,
  params: Record<string, unknown>,
) => channelGatewayInstance.linkedinSearch(accountId, params);
export const linkedinGetSearchParams = (
  accountId: string,
  type: string,
  keywords?: string,
) => channelGatewayInstance.linkedinGetSearchParams(accountId, type, keywords);
export const linkedinGetProfile = (accountId: string, profileId: string) =>
  channelGatewayInstance.linkedinGetProfile(accountId, profileId);
export const linkedinSendInvite = (
  accountId: string,
  providerId: string,
  message?: string,
) => channelGatewayInstance.linkedinSendInvite(accountId, providerId, message);
export const linkedinCreatePost = (accountId: string, text: string) =>
  channelGatewayInstance.linkedinCreatePost(accountId, text);
export const linkedinListPosts = (accountId: string) =>
  channelGatewayInstance.linkedinListPosts(accountId);

export { ExternalChannelGateway };
