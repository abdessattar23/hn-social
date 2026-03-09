import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { BadRequestError } from "../lib/errors";
import { resolveUserContext } from "../lib/route-helpers";
import * as commsPlan from "../services/comms-plan";

const VALID_STATUSES = ["pending", "done", "skipped"] as const;
type StepStatusValue = (typeof VALID_STATUSES)[number];

const commsPlanRouter = new Hono();
commsPlanRouter.use("*", authMiddleware);

commsPlanRouter.get("/", async (c) => {
    const user = resolveUserContext(c);
    const plan = await commsPlan.getFullPlan(user.orgId);
    return c.json(plan);
});

commsPlanRouter.get("/steps", (c) => {
    return c.json(commsPlan.listJourneySteps());
});

commsPlanRouter.patch("/:stepKey/:batchNumber", async (c) => {
    const user = resolveUserContext(c);
    const stepKey = c.req.param("stepKey");
    const batchNumber = Number(c.req.param("batchNumber"));

    if (isNaN(batchNumber) || !Number.isInteger(batchNumber)) {
        throw new BadRequestError("Batch number must be a valid integer");
    }

    const body = await c.req.json<{ status?: string }>().catch(() => ({}));
    const status = (body.status ?? "done") as string;

    if (!VALID_STATUSES.includes(status as StepStatusValue)) {
        throw new BadRequestError(`Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const result = await commsPlan.toggleStep(
        user.orgId,
        stepKey,
        batchNumber,
        status as StepStatusValue,
        user.id,
    );
    return c.json(result);
});

export default commsPlanRouter;
