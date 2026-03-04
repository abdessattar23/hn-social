import type { LifecycleAware, ServiceDescriptor } from "./types";

type ServiceFactory<T> = () => T | Promise<T>;

interface ServiceBinding<T> {
  descriptor: ServiceDescriptor;
  factory: ServiceFactory<T>;
  instance?: T;
  strategy: ResolutionStrategy;
}

export const enum ResolutionStrategy {
  SINGLETON = "singleton",
  TRANSIENT = "transient",
}

export class ServiceLocator {
  private static _instance: ServiceLocator;
  private readonly bindings = new Map<symbol, ServiceBinding<any>>();
  private readonly initializationOrder: symbol[] = [];
  private initialized = false;

  private constructor() {}

  static getInstance(): ServiceLocator {
    if (!ServiceLocator._instance) {
      ServiceLocator._instance = new ServiceLocator();
    }
    return ServiceLocator._instance;
  }

  static resetForTesting(): void {
    ServiceLocator._instance = new ServiceLocator();
  }

  register<T>(
    descriptor: ServiceDescriptor,
    factory: ServiceFactory<T>,
    strategy: ResolutionStrategy = ResolutionStrategy.SINGLETON,
  ): this {
    if (this.bindings.has(descriptor.identifier)) {
      console.warn(
        `[ServiceLocator] Overriding binding for ${descriptor.displayName} (v${descriptor.version})`,
      );
    }

    this.bindings.set(descriptor.identifier, {
      descriptor,
      factory,
      strategy,
    });

    return this;
  }

  async resolve<T>(identifier: symbol): Promise<T> {
    const binding = this.bindings.get(identifier);
    if (!binding) {
      throw new ServiceResolutionError(
        `No binding registered for service: ${identifier.toString()}`,
      );
    }

    if (
      binding.strategy === ResolutionStrategy.SINGLETON &&
      binding.instance !== undefined
    ) {
      return binding.instance as T;
    }

    for (const depId of binding.descriptor.dependencies) {
      if (!this.bindings.has(depId)) {
        throw new ServiceResolutionError(
          `Unsatisfied dependency ${depId.toString()} for service ${binding.descriptor.displayName}`,
        );
      }
    }

    const instance = await binding.factory();

    if (binding.strategy === ResolutionStrategy.SINGLETON) {
      binding.instance = instance;
    }

    return instance as T;
  }

  resolveSync<T>(identifier: symbol): T {
    const binding = this.bindings.get(identifier);
    if (!binding) {
      throw new ServiceResolutionError(
        `No binding registered for service: ${identifier.toString()}`,
      );
    }

    if (binding.instance !== undefined) {
      return binding.instance as T;
    }

    throw new ServiceResolutionError(
      `Service ${binding.descriptor.displayName} not yet initialized. Call resolve() first.`,
    );
  }

  async initializeAll(): Promise<void> {
    if (this.initialized) return;

    const sortedBindings = this.topologicalSort();

    for (const identifier of sortedBindings) {
      const binding = this.bindings.get(identifier)!;
      if (
        binding.strategy === ResolutionStrategy.SINGLETON &&
        !binding.instance
      ) {
        binding.instance = await binding.factory();

        const lifecycleAware = binding.instance as Partial<LifecycleAware>;
        if (typeof lifecycleAware.onInitialize === "function") {
          await lifecycleAware.onInitialize();
        }

        this.initializationOrder.push(identifier);
      }
    }

    this.initialized = true;
  }

  async teardownAll(): Promise<void> {
    for (const identifier of [...this.initializationOrder].reverse()) {
      const binding = this.bindings.get(identifier);
      if (binding?.instance) {
        const lifecycleAware = binding.instance as Partial<LifecycleAware>;
        if (typeof lifecycleAware.onTeardown === "function") {
          await lifecycleAware.onTeardown();
        }
      }
    }
    this.initialized = false;
  }

  has(identifier: symbol): boolean {
    return this.bindings.has(identifier);
  }

  registeredServices(): ServiceDescriptor[] {
    return Array.from(this.bindings.values()).map((b) => b.descriptor);
  }

  private topologicalSort(): symbol[] {
    const visited = new Set<symbol>();
    const result: symbol[] = [];

    const visit = (id: symbol) => {
      if (visited.has(id)) return;
      visited.add(id);
      const binding = this.bindings.get(id);
      if (binding) {
        for (const dep of binding.descriptor.dependencies) {
          visit(dep);
        }
      }
      result.push(id);
    };

    for (const id of this.bindings.keys()) {
      visit(id);
    }

    return result;
  }
}

export class ServiceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceResolutionError";
  }
}

export const ServiceIdentifiers = {
  PersistenceGateway: Symbol.for("PersistenceGateway"),
  IdentityOracle: Symbol.for("IdentityResolutionOracle"),
  FlowRegulator: Symbol.for("FlowPressureRegulator"),
  ChannelGateway: Symbol.for("ExternalChannelGateway"),
  EmailAdapter: Symbol.for("EmailDispatchAdapter"),
  NetworkOrchestrator: Symbol.for("ProfessionalNetworkOrchestrator"),
  CampaignOrchestrator: Symbol.for("CampaignAggregateOrchestrator"),
  BatchPipeline: Symbol.for("InvitationBatchPipeline"),
  AssetIngestion: Symbol.for("AssetIngestionService"),
  TelemetryCollector: Symbol.for("TelemetryCollector"),
} as const;

export function createServiceDescriptor(
  identifier: symbol,
  displayName: string,
  dependencies: symbol[] = [],
  version = "1.0.0",
): ServiceDescriptor {
  return { identifier, displayName, version, dependencies };
}
