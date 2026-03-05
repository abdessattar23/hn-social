import { db } from "../db/client";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";
import {
  CircuitBreakerRegistry,
  createThrottlePolicy,
  throttledExecution,
} from "../core/pipeline";
import { AsyncResult, TelemetryCollector } from "../core/monad";
import type { ThrottlePolicy, BatchPhase } from "../core/types";

const batchCircuitBreaker = new CircuitBreakerRegistry();
const telemetry = TelemetryCollector.shared();

const RESOLUTION_THROTTLE: ThrottlePolicy = {
  minIntervalMs: 500,
  maxIntervalMs: 1000,
  jitterFactor: 0.3,
};

const LINKEDIN_INTERACTION_THROTTLE: ThrottlePolicy =
  createThrottlePolicy("LINKEDIN");

interface BatchContactProjection {
  id: number;
  batch_id: number;
  provider_id: string | null;
  public_identifier: string | null;
  name: string;
  headline: string;
  company: string;
  profile_url: string;
  invite_status: string;
  invite_error: string | null;
  message_status: string | null;
  message_error: string | null;
  [key: string]: any;
}

interface BatchAggregateProjection {
  id: number;
  org_id: number;
  account_id: string;
  name: string;
  note_template: string;
  message_template: string | null;
  status: string;
  total: number;
  invited: number;
  invite_failed: number;
  messaged: number;
  message_failed: number;
  contacts: BatchContactProjection[];
  [key: string]: any;
}

interface ProfileResolutionAccumulator {
  resolved: number;
  failed: number;
  skipped: number;
}

interface TemplateInterpolationContext {
  name: string;
  company: string;
}

function interpolateTemplate(
  template: string,
  context: TemplateInterpolationContext,
): string {
  return template
    .replace(/\{\{name\}\}/g, context.name || "")
    .replace(/\{\{company\}\}/g, context.company || "");
}

function classifyIdentifier(raw: string): {
  type: "provider_id" | "public_id";
  value: string;
} {
  const trimmed = raw.trim();

  if (trimmed.startsWith("http")) {
    const linkedinProfileMatch = trimmed.match(
      /linkedin\.com\/in\/([^/?#]+)/,
    );
    if (linkedinProfileMatch)
      return { type: "public_id", value: linkedinProfileMatch[1] };

    const salesNavMatch = trimmed.match(
      /linkedin\.com\/sales\/lead\/([^,/?#]+)/,
    );
    if (salesNavMatch)
      return { type: "provider_id", value: salesNavMatch[1] };
  }

  const providerIdPrefixes = ["ACo", "AEm", "ACw"];
  if (providerIdPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return { type: "provider_id", value: trimmed };
  }

  return { type: "public_id", value: trimmed };
}

async function verifyBatchOwnership(
  accountId: string,
  orgId: number,
): Promise<void> {
  const { data, error } = await db
    .from("connected_accounts")
    .select("id")
    .eq("unipile_account_id", accountId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data)
    throw new BadRequestError(
      "Account not connected to your organization",
    );
}

function contactRequiresResolution(
  contact: BatchContactProjection,
): boolean {
  if (!contact.provider_id) return true;
  if (!contact.name || contact.name.trim() === "") return true;
  return false;
}

export async function create(
  orgId: number,
  accountId: string,
  name: string,
  noteTemplate: string,
  contacts: {
    identifier: string;
    name?: string;
    headline?: string;
    company?: string;
    profileUrl?: string;
  }[],
) {
  await verifyBatchOwnership(accountId, orgId);

  const batchCreation = await AsyncResult.from(async () => {
    const { data: batch, error: batchErr } = await db
      .from("invitation_batches")
      .insert({
        org_id: orgId,
        account_id: accountId,
        name,
        note_template: noteTemplate,
        total: contacts.length,
      })
      .select()
      .single();
    if (batchErr || !batch)
      throw new BadRequestError(
        batchErr?.message || "Failed to create batch",
      );
    return batch;
  }, "batch.create").resolve();

  const contactRows = contacts.map((c) => {
    const classified = classifyIdentifier(c.identifier);
    return {
      batch_id: batchCreation.id,
      provider_id:
        classified.type === "provider_id" ? classified.value : null,
      public_identifier:
        classified.type === "public_id" ? classified.value : null,
      name: c.name || "",
      headline: c.headline || "",
      company: c.company || "",
      profile_url: c.profileUrl || "",
    };
  });

  if (contactRows.length) {
    const { error: contactErr } = await db
      .from("invitation_batch_contacts")
      .insert(contactRows);
    if (contactErr) throw new BadRequestError(contactErr.message);
  }

  telemetry.record("batch.created", batchCreation.id, {
    contactCount: contacts.length,
  });

  return batchCreation;
}

export async function findAll(orgId: number) {
  const { data, error } = await db
    .from("invitation_batches")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
}

export async function findOne(
  id: number,
  orgId: number,
): Promise<BatchAggregateProjection> {
  const { data: batch, error } = await db
    .from("invitation_batches")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (error || !batch) throw new NotFoundError("Batch not found");

  const { data: contacts } = await db
    .from("invitation_batch_contacts")
    .select("*")
    .eq("batch_id", id)
    .order("created_at", { ascending: true });

  return {
    ...batch,
    contacts: (contacts || []) as BatchContactProjection[],
  } as BatchAggregateProjection;
}

export async function startResolveProfiles(
  accountId: string,
  batchId: number,
  orgId: number,
) {
  console.log(
    `[Batch ${batchId}] startResolveProfiles called, accountId=${accountId}`,
  );

  const { data: claimed, error } = await db
    .from("invitation_batches")
    .update({ status: "RESOLVING" })
    .eq("id", batchId)
    .eq("org_id", orgId)
    .eq("status", "DRAFT")
    .select()
    .maybeSingle();

  if (error) {
    console.error(
      `[Batch ${batchId}] Failed to claim batch:`,
      error.message,
    );
    throw new BadRequestError(error.message);
  }
  if (!claimed) {
    console.error(
      `[Batch ${batchId}] Batch not in DRAFT status or not found`,
    );
    throw new BadRequestError(
      "Batch must be in DRAFT status to resolve profiles",
    );
  }

  console.log(
    `[Batch ${batchId}] Claimed batch, starting background resolution`,
  );
  batchCircuitBreaker.reset(batchId);

  executeProfileResolutionPipeline(accountId, batchId).catch((err) => {
    console.error(
      `[Batch ${batchId}] Profile resolution crashed:`,
      err.message,
      err.stack,
    );
    db.from("invitation_batches")
      .update({ status: "DRAFT" })
      .eq("id", batchId)
      .then(() => {});
  });

  return { status: "RESOLVING" };
}

async function executeProfileResolutionPipeline(
  accountId: string,
  batchId: number,
) {
  console.log(
    `[Batch ${batchId}] Starting profile resolution with account ${accountId}`,
  );

  const { data: contacts, error: fetchErr } = await db
    .from("invitation_batch_contacts")
    .select("*")
    .eq("batch_id", batchId)
    .order("id", { ascending: true });

  if (fetchErr) {
    console.error(
      `[Batch ${batchId}] Failed to fetch contacts:`,
      fetchErr.message,
    );
    await db
      .from("invitation_batches")
      .update({ status: "DRAFT" })
      .eq("id", batchId);
    return;
  }

  const allContacts = (contacts || []) as BatchContactProjection[];
  const pendingResolution = allContacts.filter(contactRequiresResolution);
  const accumulator: ProfileResolutionAccumulator = {
    resolved: 0,
    failed: 0,
    skipped: allContacts.length - pendingResolution.length,
  };

  console.log(
    `[Batch ${batchId}] Total contacts: ${allContacts.length}, need resolution: ${pendingResolution.length}, skipped (already resolved): ${accumulator.skipped}`,
  );

  let isFirstIteration = true;

  for (let i = 0; i < pendingResolution.length; i++) {
    const contact = pendingResolution[i];

    if (batchCircuitBreaker.isTripped(batchId)) {
      console.log(
        `[Batch ${batchId}] Stop requested at ${accumulator.resolved}/${pendingResolution.length}`,
      );
      break;
    }

    if (!isFirstIteration) await throttledExecution(RESOLUTION_THROTTLE);
    isFirstIteration = false;

    if (batchCircuitBreaker.isTripped(batchId)) {
      console.log(
        `[Batch ${batchId}] Stop requested at ${accumulator.resolved}/${pendingResolution.length}`,
      );
      break;
    }

    const identifier = contact.public_identifier || contact.provider_id;
    if (!identifier) {
      console.log(
        `[Batch ${batchId}] Contact ${contact.id} has no identifier, skipping`,
      );
      accumulator.failed++;
      continue;
    }

    try {
      console.log(
        `[Batch ${batchId}] Resolving ${i + 1}/${pendingResolution.length}: ${identifier}`,
      );

      const profile = await unipile.linkedinGetProfile(
        accountId,
        identifier,
      );
      const mutations: Record<string, any> = {};

      if (!contact.provider_id && profile.provider_id) {
        mutations.provider_id = profile.provider_id;
      }
      if (!contact.name || contact.name.trim() === "") {
        const fullName =
          `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
        if (fullName) mutations.name = fullName;
      }
      if (!contact.headline && profile.headline)
        mutations.headline = profile.headline;
      if (
        !contact.company &&
        profile.current_positions?.[0]?.company
      ) {
        mutations.company = profile.current_positions[0].company;
      }
      if (!contact.profile_url && profile.public_profile_url) {
        mutations.profile_url = profile.public_profile_url;
      }
      if (profile.network_distance === "DISTANCE_1") {
        mutations.invite_status = "ALREADY_CONNECTED";
      }

      if (Object.keys(mutations).length > 0) {
        await db
          .from("invitation_batch_contacts")
          .update(mutations)
          .eq("id", contact.id);
        console.log(
          `[Batch ${batchId}] Resolved ${identifier}: ${Object.keys(mutations).join(", ")}`,
        );
      } else {
        console.log(
          `[Batch ${batchId}] No updates needed for ${identifier}`,
        );
      }

      accumulator.resolved++;
    } catch (err: any) {
      accumulator.failed++;
      console.error(
        `[Batch ${batchId}] Failed to resolve ${identifier}: ${err.message || err}`,
      );
    }
  }

  batchCircuitBreaker.reset(batchId);
  await db
    .from("invitation_batches")
    .update({ status: "DRAFT" })
    .eq("id", batchId);
  console.log(
    `[Batch ${batchId}] Resolution complete: ${accumulator.resolved} resolved, ${accumulator.failed} failed, ${accumulator.skipped} skipped`,
  );
}

export async function sendInvitations(id: number, orgId: number) {
  const { data: claimed, error } = await db
    .from("invitation_batches")
    .update({ status: "INVITING", invited: 0, invite_failed: 0 })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("status", "DRAFT")
    .select()
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!claimed)
    throw new BadRequestError(
      "Batch is not in DRAFT status or does not exist",
    );

  batchCircuitBreaker.reset(id);

  executeInvitationDispatchPipeline(claimed).catch((err) => {
    console.error(
      `Batch ${id} invitation processing crashed:`,
      err.message,
    );
  });

  return { status: "INVITING" };
}

async function executeInvitationDispatchPipeline(batch: any) {
  const { data: contacts } = await db
    .from("invitation_batch_contacts")
    .select("*")
    .eq("batch_id", batch.id)
    .in("invite_status", ["PENDING"])
    .order("id", { ascending: true });

  let invited = 0;
  let failed = 0;
  let isFirstIteration = true;

  for (const contact of contacts || []) {
    if (batchCircuitBreaker.isTripped(batch.id)) break;

    if (!isFirstIteration)
      await throttledExecution(LINKEDIN_INTERACTION_THROTTLE);
    isFirstIteration = false;

    if (batchCircuitBreaker.isTripped(batch.id)) break;

    if (!contact.provider_id) {
      await db
        .from("invitation_batch_contacts")
        .update({
          invite_status: "FAILED",
          invite_error: "No provider_id resolved",
        })
        .eq("id", contact.id);
      failed++;
      await db
        .from("invitation_batches")
        .update({ invited, invite_failed: failed })
        .eq("id", batch.id);
      continue;
    }

    const personalizedNote = batch.note_template
      ? interpolateTemplate(batch.note_template, {
          name: contact.name,
          company: contact.company,
        })
      : undefined;

    try {
      await unipile.linkedinSendInvite(
        batch.account_id,
        contact.provider_id,
        personalizedNote,
      );
      await db
        .from("invitation_batch_contacts")
        .update({ invite_status: "SENT" })
        .eq("id", contact.id);
      invited++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .from("invitation_batch_contacts")
        .update({ invite_status: "FAILED", invite_error: msg })
        .eq("id", contact.id);
      failed++;
    }

    await db
      .from("invitation_batches")
      .update({ invited, invite_failed: failed })
      .eq("id", batch.id);
  }

  if (batchCircuitBreaker.isTripped(batch.id)) {
    batchCircuitBreaker.reset(batch.id);
  }

  await db
    .from("invitation_batches")
    .update({ status: "INVITED", invited, invite_failed: failed })
    .eq("id", batch.id);

  telemetry.record("batch.invitationsComplete", batch.id, {
    invited,
    failed,
  });
}

export async function sendMessages(
  id: number,
  orgId: number,
  messageTemplate: string,
) {
  const { data: claimed, error } = await db
    .from("invitation_batches")
    .update({
      status: "MESSAGING",
      message_template: messageTemplate,
      messaged: 0,
      message_failed: 0,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .eq("status", "INVITED")
    .select()
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!claimed)
    throw new BadRequestError(
      "Batch must be in INVITED status to send messages",
    );

  batchCircuitBreaker.reset(id);

  executeMessageDispatchPipeline(claimed).catch((err) => {
    console.error(
      `Batch ${id} message processing crashed:`,
      err.message,
    );
  });

  return { status: "MESSAGING" };
}

async function executeMessageDispatchPipeline(batch: any) {
  const { data: contacts } = await db
    .from("invitation_batch_contacts")
    .select("*")
    .eq("batch_id", batch.id)
    .is("message_status", null)
    .order("id", { ascending: true });

  let messaged = 0;
  let failed = 0;
  let isFirstIteration = true;

  for (const contact of contacts || []) {
    if (batchCircuitBreaker.isTripped(batch.id)) break;

    if (!isFirstIteration)
      await throttledExecution(LINKEDIN_INTERACTION_THROTTLE);
    isFirstIteration = false;

    if (batchCircuitBreaker.isTripped(batch.id)) break;

    if (!contact.provider_id) {
      await db
        .from("invitation_batch_contacts")
        .update({
          message_status: "FAILED",
          message_error: "No provider_id",
        })
        .eq("id", contact.id);
      failed++;
      await db
        .from("invitation_batches")
        .update({ messaged, message_failed: failed })
        .eq("id", batch.id);
      continue;
    }

    const personalizedMessage = interpolateTemplate(
      batch.message_template,
      { name: contact.name, company: contact.company },
    );

    try {
      await unipile.sendMessageToUser(
        batch.account_id,
        contact.provider_id,
        personalizedMessage,
      );
      await db
        .from("invitation_batch_contacts")
        .update({ message_status: "SENT" })
        .eq("id", contact.id);
      messaged++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .from("invitation_batch_contacts")
        .update({ message_status: "FAILED", message_error: msg })
        .eq("id", contact.id);
      failed++;
    }

    await db
      .from("invitation_batches")
      .update({ messaged, message_failed: failed })
      .eq("id", batch.id);
  }

  if (batchCircuitBreaker.isTripped(batch.id)) {
    batchCircuitBreaker.reset(batch.id);
  }

  await db
    .from("invitation_batches")
    .update({ status: "DONE", messaged, message_failed: failed })
    .eq("id", batch.id);

  telemetry.record("batch.messagingComplete", batch.id, {
    messaged,
    failed,
  });
}

export async function exportToList(id: number, orgId: number) {
  const batch = await findOne(id, orgId);

  const { data: list, error: listErr } = await db
    .from("contact_lists")
    .insert({
      org_id: orgId,
      name: `Batch: ${batch.name}`,
      type: "LINKEDIN",
      tags: ["batch-export"],
    })
    .select()
    .single();
  if (listErr || !list)
    throw new BadRequestError(
      listErr?.message || "Failed to create list",
    );

  const exportableContacts = (batch.contacts || [])
    .filter((c: any) => c.provider_id)
    .map((c: any) => ({
      list_id: list.id,
      name: c.name || "",
      identifier: c.provider_id,
    }));

  if (exportableContacts.length) {
    const { error: contactErr } = await db
      .from("contacts")
      .insert(exportableContacts);
    if (contactErr) throw new BadRequestError(contactErr.message);
  }

  telemetry.record("batch.exported", id, {
    listId: list.id,
    contactsExported: exportableContacts.length,
  });

  return {
    listId: list.id,
    listName: list.name,
    contactsExported: exportableContacts.length,
  };
}

export async function stopBatch(id: number, orgId: number) {
  const batch = await findOne(id, orgId);
  console.log(
    `[Batch ${id}] Stop requested, current status: ${batch.status}`,
  );

  const activePhases: BatchPhase[] = ["INVITING", "MESSAGING", "RESOLVING"];
  if (!activePhases.includes(batch.status as BatchPhase)) {
    throw new BadRequestError("Batch is not currently processing");
  }

  batchCircuitBreaker.trip(id);
  console.log(`[Batch ${id}] Added to stop set, updating DB status`);

  const phaseTransitions: Record<string, { status: string; message: string }> =
    {
      RESOLVING: { status: "DRAFT", message: "Resolution stopped" },
      INVITING: { status: "INVITED", message: "Invitations stopped" },
      MESSAGING: { status: "DONE", message: "Messaging stopped" },
    };

  const transition = phaseTransitions[batch.status];
  await db
    .from("invitation_batches")
    .update({ status: transition.status })
    .eq("id", id);
  console.log(
    `[Batch ${id}] Status set to ${transition.status} (was ${batch.status})`,
  );

  return { status: transition.status, message: transition.message };
}

export async function remove(id: number, orgId: number) {
  const batch = await findOne(id, orgId);
  const activePhases: BatchPhase[] = ["INVITING", "MESSAGING", "RESOLVING"];

  if (activePhases.includes(batch.status as BatchPhase)) {
    throw new BadRequestError(
      "Cannot delete a batch that is currently processing. Stop it first.",
    );
  }

  await db
    .from("invitation_batch_contacts")
    .delete()
    .eq("batch_id", id);
  await db.from("invitation_batches").delete().eq("id", id);

  return { deleted: true };
}
