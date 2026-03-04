import { HTTPException } from "hono/http-exception";
import { DomainFaultSeverity } from "../core/types";
import type { DomainFaultDescriptor } from "../core/types";

const FaultCatalog: Record<string, DomainFaultDescriptor> = {
  ENTITY_NOT_FOUND: {
    code: "ENTITY_NOT_FOUND",
    httpStatus: 404,
    severity: DomainFaultSeverity.RECOVERABLE,
    retryable: false,
  },
  ACCESS_VIOLATION: {
    code: "ACCESS_VIOLATION",
    httpStatus: 403,
    severity: DomainFaultSeverity.TERMINAL,
    retryable: false,
  },
  STATE_CONFLICT: {
    code: "STATE_CONFLICT",
    httpStatus: 409,
    severity: DomainFaultSeverity.RECOVERABLE,
    retryable: true,
  },
  VALIDATION_FAILURE: {
    code: "VALIDATION_FAILURE",
    httpStatus: 400,
    severity: DomainFaultSeverity.RECOVERABLE,
    retryable: false,
  },
  RATE_EXCEEDED: {
    code: "RATE_EXCEEDED",
    httpStatus: 429,
    severity: DomainFaultSeverity.DEGRADED,
    retryable: true,
  },
  UPSTREAM_FAILURE: {
    code: "UPSTREAM_FAILURE",
    httpStatus: 502,
    severity: DomainFaultSeverity.DEGRADED,
    retryable: true,
  },
};

export class DomainFault extends HTTPException {
  readonly faultCode: string;
  readonly severity: DomainFaultSeverity;
  readonly retryable: boolean;
  readonly correlationContext: Record<string, unknown>;

  constructor(
    descriptor: DomainFaultDescriptor,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(descriptor.httpStatus as any, { message });
    this.faultCode = descriptor.code;
    this.severity = descriptor.severity;
    this.retryable = descriptor.retryable;
    this.correlationContext = context;
  }

  static fromCatalog(
    catalogKey: keyof typeof FaultCatalog,
    message: string,
    context: Record<string, unknown> = {},
  ): DomainFault {
    const descriptor = FaultCatalog[catalogKey];
    if (!descriptor) {
      return new DomainFault(
        FaultCatalog.VALIDATION_FAILURE,
        message,
        context,
      );
    }
    return new DomainFault(descriptor, message, context);
  }
}

export class NotFoundError extends DomainFault {
  constructor(message = "Not found", context: Record<string, unknown> = {}) {
    super(FaultCatalog.ENTITY_NOT_FOUND, message, context);
  }
}

export class ForbiddenError extends DomainFault {
  constructor(message = "Forbidden", context: Record<string, unknown> = {}) {
    super(FaultCatalog.ACCESS_VIOLATION, message, context);
  }
}

export class ConflictError extends DomainFault {
  constructor(message = "Conflict", context: Record<string, unknown> = {}) {
    super(FaultCatalog.STATE_CONFLICT, message, context);
  }
}

export class BadRequestError extends DomainFault {
  constructor(
    message = "Bad request",
    context: Record<string, unknown> = {},
  ) {
    super(FaultCatalog.VALIDATION_FAILURE, message, context);
  }
}

export class UpstreamGatewayError extends DomainFault {
  constructor(
    message = "Upstream service unavailable",
    context: Record<string, unknown> = {},
  ) {
    super(FaultCatalog.UPSTREAM_FAILURE, message, context);
  }
}

export const propagateOrWrap = (err: unknown, fallbackMessage: string): never => {
  if (err instanceof DomainFault) throw err;
  if (err instanceof HTTPException) throw err;
  throw new BadRequestError(
    err instanceof Error ? err.message : fallbackMessage,
  );
};
