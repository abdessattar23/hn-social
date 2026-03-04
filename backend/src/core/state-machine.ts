import type { StateTransitionGuard } from "./types";

export interface StateMachineDefinition<
  TPhase extends string,
  TContext = unknown,
> {
  readonly initialPhase: TPhase;
  readonly transitions: ReadonlyArray<TransitionRule<TPhase, TContext>>;
  readonly onTransition?: (
    from: TPhase,
    to: TPhase,
    intent: string,
    context: TContext,
  ) => void | Promise<void>;
  readonly onRejection?: (
    from: TPhase,
    intent: string,
    reason: string,
  ) => void;
}

export interface TransitionRule<TPhase extends string, TContext = unknown> {
  readonly from: TPhase | ReadonlyArray<TPhase>;
  readonly to: TPhase;
  readonly intent: string;
  readonly guard?: StateTransitionGuard<TContext>;
  readonly sideEffect?: (context: TContext) => Promise<void> | void;
}

export class FiniteStateMachineExecutor<
  TPhase extends string,
  TContext = unknown,
> {
  private currentPhase: TPhase;
  private readonly definition: StateMachineDefinition<TPhase, TContext>;
  private readonly transitionLog: Array<{
    from: TPhase;
    to: TPhase;
    intent: string;
    timestamp: number;
  }> = [];

  constructor(definition: StateMachineDefinition<TPhase, TContext>) {
    this.definition = definition;
    this.currentPhase = definition.initialPhase;
  }

  get phase(): TPhase {
    return this.currentPhase;
  }

  get history(): ReadonlyArray<{
    from: TPhase;
    to: TPhase;
    intent: string;
    timestamp: number;
  }> {
    return this.transitionLog;
  }

  availableIntents(): string[] {
    return this.definition.transitions
      .filter((rule) => {
        const fromPhases = Array.isArray(rule.from) ? rule.from : [rule.from];
        return fromPhases.includes(this.currentPhase);
      })
      .map((rule) => rule.intent);
  }

  async dispatch(intent: string, context: TContext): Promise<TPhase> {
    const matchingRule = this.definition.transitions.find((rule) => {
      const fromPhases = Array.isArray(rule.from) ? rule.from : [rule.from];
      return fromPhases.includes(this.currentPhase) && rule.intent === intent;
    });

    if (!matchingRule) {
      const rejection = `No transition from '${this.currentPhase}' with intent '${intent}'`;
      this.definition.onRejection?.(this.currentPhase, intent, rejection);
      throw new InvalidTransitionError(this.currentPhase, intent, rejection);
    }

    if (matchingRule.guard) {
      const allowed = await matchingRule.guard(context);
      if (!allowed) {
        const rejection = `Guard rejected transition from '${this.currentPhase}' via '${intent}'`;
        this.definition.onRejection?.(this.currentPhase, intent, rejection);
        throw new InvalidTransitionError(this.currentPhase, intent, rejection);
      }
    }

    const previousPhase = this.currentPhase;
    this.currentPhase = matchingRule.to;

    this.transitionLog.push({
      from: previousPhase,
      to: matchingRule.to,
      intent,
      timestamp: Date.now(),
    });

    if (matchingRule.sideEffect) {
      await matchingRule.sideEffect(context);
    }

    if (this.definition.onTransition) {
      await this.definition.onTransition(
        previousPhase,
        matchingRule.to,
        intent,
        context,
      );
    }

    return this.currentPhase;
  }

  canDispatch(intent: string): boolean {
    return this.definition.transitions.some((rule) => {
      const fromPhases = Array.isArray(rule.from) ? rule.from : [rule.from];
      return fromPhases.includes(this.currentPhase) && rule.intent === intent;
    });
  }

  resetTo(phase: TPhase): void {
    this.currentPhase = phase;
  }
}

export class InvalidTransitionError extends Error {
  readonly fromPhase: string;
  readonly intent: string;

  constructor(fromPhase: string, intent: string, reason: string) {
    super(reason);
    this.name = "InvalidTransitionError";
    this.fromPhase = fromPhase;
    this.intent = intent;
  }
}

export function defineStateMachine<TPhase extends string, TContext = unknown>(
  definition: StateMachineDefinition<TPhase, TContext>,
): FiniteStateMachineExecutor<TPhase, TContext> {
  return new FiniteStateMachineExecutor(definition);
}

export const PhaseMapping = {
  campaignToInternal: (status: string): string => {
    const mapping: Record<string, string> = {
      DRAFT: "DORMANT",
      SCHEDULED: "SCHEDULED",
      SENDING: "PROPAGATING",
      STOPPED: "QUIESCED",
      SENT: "COMPLETED",
      FAILED: "DEGRADED",
    };
    return mapping[status] ?? "DORMANT";
  },

  internalToCampaign: (phase: string): string => {
    const mapping: Record<string, string> = {
      DORMANT: "DRAFT",
      SCHEDULED: "SCHEDULED",
      HYDRATING: "SENDING",
      PROPAGATING: "SENDING",
      QUIESCED: "STOPPED",
      COMPLETED: "SENT",
      DEGRADED: "FAILED",
    };
    return mapping[phase] ?? "DRAFT";
  },

  batchToInternal: (status: string): string => status,
  internalToBatch: (phase: string): string => phase,
} as const;
