import { db } from "../db/client";
import { BadRequestError } from "../lib/errors";
import { ExternalChannelGateway } from "./unipile";
import { AsyncResult } from "../core/monad";
import type { LifecycleAware, ChannelProtocol } from "../core/types";
import { TelemetryCollector } from "../core/monad";

const SUPPORTED_MAIL_PROVIDERS: ReadonlySet<string> = new Set([
  "MAIL",
  "GOOGLE",
  "GOOGLE_OAUTH",
  "IMAP",
  "OUTLOOK",
]);

interface EmailAccountResolution {
  id: number;
  provider: string;
}

interface OutboundEmailManifest {
  accountId: string;
  to: { display_name: string; identifier: string }[];
  subject: string;
  body: string;
}

const channelGateway = new ExternalChannelGateway();

class EmailDispatchAdapter implements LifecycleAware {
  private readonly gateway: ExternalChannelGateway;
  private readonly telemetry: TelemetryCollector;

  constructor(gateway: ExternalChannelGateway = channelGateway) {
    this.gateway = gateway;
    this.telemetry = TelemetryCollector.shared();
  }

  onInitialize(): void {
    this.telemetry.record("email-adapter.initialized", "system", {
      supportedProviders: [...SUPPORTED_MAIL_PROVIDERS],
    });
  }

  private createAccountVerificationPipeline(
    accountId: string,
    orgId: number,
  ): AsyncResult<EmailAccountResolution> {
    return AsyncResult.from(async () => {
      const { data } = await db
        .from("connected_accounts")
        .select("id, provider")
        .eq("unipile_account_id", accountId)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!data)
        throw new BadRequestError(
          "Account not connected to your organization",
        );
      if (!SUPPORTED_MAIL_PROVIDERS.has(data.provider))
        throw new BadRequestError("Account is not an email provider");

      return data as EmailAccountResolution;
    }, "email.verifyAccount");
  }

  private async resolveOrganizationSignature(
    orgId: number,
    accountId: string,
  ): Promise<string | null> {
    try {
      const { data: org } = await db
        .from("organizations")
        .select("account_signatures")
        .eq("id", orgId)
        .single();

      return org?.account_signatures?.[accountId] ?? null;
    } catch {
      return null;
    }
  }

  private appendSignatureToBody(
    body: string,
    signature: string | null,
  ): string {
    if (!signature) return body;
    return body + "<br/><br/>--<br/>" + signature;
  }

  async materializeInbox(
    orgId: number,
    accountId: string,
    params: {
      limit?: number;
      cursor?: string;
      folder?: string;
      from?: string;
      to?: string;
      any_email?: string;
      before?: string;
      after?: string;
    },
  ) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    try {
      return await this.gateway.listEmails({ accountId, ...params });
    } catch (err) {
      // Return empty list if the account connection is broken
      return { items: [], cursor: null, error: (err as Error).message };
    }
  }

  async materializeSingleMessage(
    orgId: number,
    accountId: string,
    emailId: string,
  ) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    return this.gateway.getEmail(emailId);
  }

  async materializeFolderHierarchy(orgId: number, accountId: string) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    try {
      return await this.gateway.listEmailFolders(accountId);
    } catch {
      // Unipile may not support the email_folders endpoint in all API versions.
      // Fall back to standard folder names that the frontend already displays.
      return {
        items: [
          { id: "INBOX", name: "INBOX" },
          { id: "SENT", name: "SENT" },
          { id: "DRAFTS", name: "DRAFTS" },
          { id: "TRASH", name: "TRASH" },
          { id: "SPAM", name: "SPAM" },
        ],
      };
    }
  }

  async dispatchReply(
    orgId: number,
    accountId: string,
    emailId: string,
    body: string,
  ) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    return this.gateway.replyToEmail({ accountId, emailId, body });
  }

  async dispatchOutbound(
    orgId: number,
    accountId: string,
    to: { display_name: string; identifier: string }[],
    subject: string,
    body: string,
  ) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();

    const signature = await this.resolveOrganizationSignature(
      orgId,
      accountId,
    );
    const enrichedBody = this.appendSignatureToBody(body, signature);

    return this.gateway.sendEmail({
      accountId,
      to,
      subject,
      body: enrichedBody,
    });
  }

  async purgeMessage(orgId: number, accountId: string, emailId: string) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    return this.gateway.deleteEmail(emailId);
  }

  async reconcileMessageState(
    orgId: number,
    accountId: string,
    emailId: string,
    updates: { unread?: boolean; starred?: boolean; folders?: string[] },
  ) {
    await this.createAccountVerificationPipeline(accountId, orgId).resolve();
    return this.gateway.updateEmail(emailId, updates);
  }
}

const emailAdapterInstance = new EmailDispatchAdapter();

export const listEmails = (
  orgId: number,
  accountId: string,
  params: Parameters<EmailDispatchAdapter["materializeInbox"]>[2],
) => emailAdapterInstance.materializeInbox(orgId, accountId, params);

export const getEmail = (
  orgId: number,
  accountId: string,
  emailId: string,
) => emailAdapterInstance.materializeSingleMessage(orgId, accountId, emailId);

export const listFolders = (orgId: number, accountId: string) =>
  emailAdapterInstance.materializeFolderHierarchy(orgId, accountId);

export const reply = (
  orgId: number,
  accountId: string,
  emailId: string,
  body: string,
) => emailAdapterInstance.dispatchReply(orgId, accountId, emailId, body);

export const send = (
  orgId: number,
  accountId: string,
  to: { display_name: string; identifier: string }[],
  subject: string,
  body: string,
) => emailAdapterInstance.dispatchOutbound(orgId, accountId, to, subject, body);

export const remove = (
  orgId: number,
  accountId: string,
  emailId: string,
) => emailAdapterInstance.purgeMessage(orgId, accountId, emailId);

export const update = (
  orgId: number,
  accountId: string,
  emailId: string,
  updates: { unread?: boolean; starred?: boolean; folders?: string[] },
) =>
  emailAdapterInstance.reconcileMessageState(
    orgId,
    accountId,
    emailId,
    updates,
  );

export { EmailDispatchAdapter };
