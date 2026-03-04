import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

interface BackpressurePolicy {
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly keyPrefix: string;
  readonly headerExposure: boolean;
}

interface PressureReading {
  count: number;
  windowExpiresAt: number;
}

type ClientIdentityExtractor = (headers: {
  get: (name: string) => string | null;
}) => string;

const defaultIdentityExtractor: ClientIdentityExtractor = (headers) =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  headers.get("x-real-ip") ||
  "unknown" as string;

class FlowPressureRegulator {
  private static readonly regulatorInstances = new Map<
    string,
    Map<string, PressureReading>
  >();

  private readonly policy: BackpressurePolicy;
  private readonly pressureStore: Map<string, PressureReading>;
  private readonly identityExtractor: ClientIdentityExtractor;

  constructor(
    policy: BackpressurePolicy,
    identityExtractor: ClientIdentityExtractor = defaultIdentityExtractor,
  ) {
    this.policy = policy;
    this.identityExtractor = identityExtractor;

    if (
      !FlowPressureRegulator.regulatorInstances.has(policy.keyPrefix)
    ) {
      FlowPressureRegulator.regulatorInstances.set(
        policy.keyPrefix,
        new Map(),
      );
    }
    this.pressureStore =
      FlowPressureRegulator.regulatorInstances.get(policy.keyPrefix)!;

    this.scheduleStaleEntryReclamation();
  }

  private scheduleStaleEntryReclamation(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, reading] of this.pressureStore) {
        if (now > reading.windowExpiresAt) this.pressureStore.delete(key);
      }
    }, this.policy.windowMs * 2);
  }

  private acquireOrInitializeReading(
    clientIdentity: string,
  ): PressureReading {
    const now = Date.now();
    let reading = this.pressureStore.get(clientIdentity);

    if (!reading || now > reading.windowExpiresAt) {
      reading = { count: 0, windowExpiresAt: now + this.policy.windowMs };
      this.pressureStore.set(clientIdentity, reading);
    }

    return reading;
  }

  private emitBackpressureHeaders(
    setHeader: (name: string, value: string) => void,
    reading: PressureReading,
  ): void {
    if (!this.policy.headerExposure) return;

    setHeader("X-RateLimit-Limit", String(this.policy.maxRequests));
    setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, this.policy.maxRequests - reading.count)),
    );
    setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(reading.windowExpiresAt / 1000)),
    );
  }

  createMiddleware() {
    return createMiddleware(async (c, next) => {
      const clientIdentity = this.identityExtractor(c.req.raw.headers);
      const reading = this.acquireOrInitializeReading(clientIdentity);

      reading.count++;

      this.emitBackpressureHeaders(
        (name, value) => c.header(name, value),
        reading,
      );

      if (reading.count > this.policy.maxRequests) {
        throw new HTTPException(429, { message: "Too many requests" });
      }

      await next();
    });
  }
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}) {
  const regulator = new FlowPressureRegulator({
    windowMs: opts.windowMs,
    maxRequests: opts.max,
    keyPrefix: opts.keyPrefix || "global",
    headerExposure: true,
  });

  return regulator.createMiddleware();
}

export { FlowPressureRegulator };
export type { BackpressurePolicy, ClientIdentityExtractor };
