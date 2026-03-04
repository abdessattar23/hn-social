import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { createBatchSchema, sendBatchMessagesSchema } from "../lib/validation";
import * as batchPipeline from "../services/batches";
import Papa from "papaparse";

type BatchIntent =
  | "list"
  | "detail"
  | "create"
  | "resolve"
  | "invite"
  | "message"
  | "export"
  | "stop"
  | "remove";

interface ColumnDetectionResult {
  column: string | null;
  confidence: "exact" | "fuzzy" | "none";
}

const IDENTIFIER_COLUMN_PRIORITY = [
  "author_profile_id",
  "public_identifier",
  "provider_id",
  "profile_url",
  "post_url",
];

const resolveUserContext = (c: any) => c.get("user");
const extractNumericParam = (c: any, key = "id") =>
  Number(c.req.param(key));

function detectIdentifierColumn(
  headers: string[],
): ColumnDetectionResult {
  for (const col of IDENTIFIER_COLUMN_PRIORITY) {
    if (headers.includes(col))
      return { column: col, confidence: "exact" };
  }

  const urlCandidate = headers.find(
    (h) =>
      h.toLowerCase().includes("url") ||
      h.toLowerCase().includes("profile"),
  );
  if (urlCandidate)
    return { column: urlCandidate, confidence: "fuzzy" };

  const idCandidate = headers.find(
    (h) =>
      h.toLowerCase().includes("identifier") ||
      h.toLowerCase().includes("id"),
  );
  if (idCandidate)
    return { column: idCandidate, confidence: "fuzzy" };

  return { column: null, confidence: "none" };
}

function hydrateContactsFromCsvRows(
  rows: Record<string, string>[],
  identifierColumn: string,
): Array<{
  identifier: string;
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
}> {
  return rows
    .filter((r) => r[identifierColumn]?.trim())
    .map((r) => ({
      identifier: r[identifierColumn].trim(),
      name:
        r["author_name"] ||
        r["name"] ||
        (r["first_name"]
          ? `${r["first_name"] || ""} ${r["last_name"] || ""}`.trim()
          : "") ||
        r["name"] ||
        r["author_name"] ||
        "",
      headline: r["author_headline"] || r["headline"] || "",
      company: r["current_company"] || r["company"] || "",
      profileUrl: r["profile_url"] || r["post_url"] || "",
    }));
}

const batchesRouter = new Hono();
batchesRouter.use("*", authMiddleware);

batchesRouter.get("/", async (c) => {
  const user = resolveUserContext(c);
  const projections = await batchPipeline.findAll(user.orgId);
  return c.json(projections);
});

batchesRouter.get("/:id", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const projection = await batchPipeline.findOne(id, user.orgId);
  return c.json(projection);
});

batchesRouter.post("/", async (c) => {
  const user = resolveUserContext(c);
  const formData = await c.req.formData();
  const name = formData.get("name") as string;
  const accountId = formData.get("accountId") as string;
  const noteTemplate =
    (formData.get("noteTemplate") as string) || "";
  const file = formData.get("file") as File;

  if (!name || !accountId)
    return c.json(
      { error: "name and accountId are required" },
      400,
    );
  if (!file) return c.json({ error: "CSV file is required" }, 400);

  const csvText = await file.text();
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.data?.length)
    return c.json({ error: "CSV is empty or invalid" }, 400);

  const rows = parsed.data as Record<string, string>[];
  const detection = detectIdentifierColumn(Object.keys(rows[0]));

  if (!detection.column)
    return c.json(
      {
        error:
          "Could not detect a profile identifier column in the CSV",
      },
      400,
    );

  const contacts = hydrateContactsFromCsvRows(rows, detection.column);

  if (!contacts.length)
    return c.json(
      { error: "No valid contacts found in CSV" },
      400,
    );

  const batch = await batchPipeline.create(
    user.orgId,
    accountId,
    name,
    noteTemplate,
    contacts,
  );
  return c.json(batch, 201);
});

batchesRouter.post("/:id/resolve", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const body = await c.req
    .json<{ accountId: string }>()
    .catch(() => ({ accountId: "" }));
  const batch = await batchPipeline.findOne(id, user.orgId);
  const result = await batchPipeline.startResolveProfiles(
    body.accountId || batch.account_id,
    id,
    user.orgId,
  );
  return c.json(result);
});

batchesRouter.post("/:id/invite", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await batchPipeline.sendInvitations(
    id,
    user.orgId,
  );
  return c.json(result);
});

batchesRouter.post(
  "/:id/message",
  zValidator("json", sendBatchMessagesSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const { messageTemplate } = c.req.valid("json");
    const result = await batchPipeline.sendMessages(
      id,
      user.orgId,
      messageTemplate,
    );
    return c.json(result);
  },
);

batchesRouter.post("/:id/export-list", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await batchPipeline.exportToList(id, user.orgId);
  return c.json(result);
});

batchesRouter.post("/:id/stop", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await batchPipeline.stopBatch(id, user.orgId);
  return c.json(result);
});

batchesRouter.delete("/:id", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await batchPipeline.remove(id, user.orgId);
  return c.json(result);
});

export default batchesRouter;
