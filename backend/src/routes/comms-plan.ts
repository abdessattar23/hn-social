import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import * as commsPlan from "../services/comms-plan";

const resolveUserContext = (c: any) => c.get("user");

const commsPlanRouter = new Hono();
commsPlanRouter.use("*", authMiddleware);

// Get full comms plan with statuses
commsPlanRouter.get("/", async (c) => {
    const user = resolveUserContext(c);
    const plan = await commsPlan.getFullPlan(user.orgId);
    return c.json(plan);
});

// Get journey steps config
commsPlanRouter.get("/steps", (c) => {
    return c.json(commsPlan.listJourneySteps());
});

// Toggle a step status
commsPlanRouter.patch("/:stepKey/:batchNumber", async (c) => {
    const user = resolveUserContext(c);
    const stepKey = c.req.param("stepKey");
    const batchNumber = Number(c.req.param("batchNumber"));
    const body = await c.req.json().catch(() => ({}));
    const status = body.status || "done";

    const result = await commsPlan.toggleStep(
        user.orgId,
        stepKey,
        batchNumber,
        status,
        user.id,
    );
    return c.json(result);
});

export default commsPlanRouter;
