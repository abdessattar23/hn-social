import type { AsyncComputation } from "./types";

export class AsyncResult<T> {
  private readonly _computation: AsyncComputation<T>;
  private readonly _label: string;

  private constructor(computation: AsyncComputation<T>, label = "anonymous") {
    this._computation = computation;
    this._label = label;
  }

  static of<T>(value: T, label = "pure"): AsyncResult<T> {
    return new AsyncResult(() => Promise.resolve(value), label);
  }

  static from<T>(fn: AsyncComputation<T>, label = "deferred"): AsyncResult<T> {
    return new AsyncResult(fn, label);
  }

  static lift<T>(promise: Promise<T>, label = "lifted"): AsyncResult<T> {
    return new AsyncResult(() => promise, label);
  }

  static sequence<T>(results: AsyncResult<T>[]): AsyncResult<T[]> {
    return new AsyncResult(
      () => Promise.all(results.map((r) => r.resolve())),
      "sequence",
    );
  }

  static traverse<T, U>(
    items: T[],
    fn: (item: T, index: number) => AsyncResult<U>,
  ): AsyncResult<U[]> {
    return AsyncResult.sequence(items.map((item, idx) => fn(item, idx)));
  }

  get label(): string {
    return this._label;
  }

  map<U>(fn: (value: T) => U, label?: string): AsyncResult<U> {
    return new AsyncResult(
      async () => fn(await this._computation()),
      label ?? `${this._label}.map`,
    );
  }

  bind<U>(fn: (value: T) => AsyncResult<U>, label?: string): AsyncResult<U> {
    return new AsyncResult(async () => {
      const intermediate = await this._computation();
      return fn(intermediate).resolve();
    }, label ?? `${this._label}.bind`);
  }

  tap(fn: (value: T) => void | Promise<void>): AsyncResult<T> {
    return new AsyncResult(async () => {
      const value = await this._computation();
      await fn(value);
      return value;
    }, `${this._label}.tap`);
  }

  tapError(handler: (err: unknown) => void | Promise<void>): AsyncResult<T> {
    return new AsyncResult(async () => {
      try {
        return await this._computation();
      } catch (err) {
        await handler(err);
        throw err;
      }
    }, `${this._label}.tapError`);
  }

  recover(handler: (err: unknown) => T | Promise<T>): AsyncResult<T> {
    return new AsyncResult(async () => {
      try {
        return await this._computation();
      } catch (err) {
        return handler(err);
      }
    }, `${this._label}.recover`);
  }

  mapError(fn: (err: unknown) => unknown): AsyncResult<T> {
    return new AsyncResult(async () => {
      try {
        return await this._computation();
      } catch (err) {
        throw fn(err);
      }
    }, `${this._label}.mapError`);
  }

  withTimeout(ms: number): AsyncResult<T> {
    return new AsyncResult(async () => {
      const result = await Promise.race([
        this._computation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
        ),
      ]);
      return result;
    }, `${this._label}.timeout(${ms})`);
  }

  async resolve(): Promise<T> {
    return this._computation();
  }

  async fold<U>(
    onSuccess: (value: T) => U | Promise<U>,
    onFailure: (err: unknown) => U | Promise<U>,
  ): Promise<U> {
    try {
      const value = await this._computation();
      return onSuccess(value);
    } catch (err) {
      return onFailure(err);
    }
  }

  async toEither(): Promise<Either<unknown, T>> {
    return this.fold<Either<unknown, T>>(
      (value) => Either.right(value),
      (err) => Either.left(err),
    );
  }
}

export type Either<L, R> =
  | { readonly tag: "left"; readonly value: L }
  | { readonly tag: "right"; readonly value: R };

export const Either = {
  left: <L, R = never>(value: L): Either<L, R> => ({
    tag: "left" as const,
    value,
  }),
  right: <L = never, R = unknown>(value: R): Either<L, R> => ({
    tag: "right" as const,
    value,
  }),
  isLeft: <L, R>(e: Either<L, R>): e is { tag: "left"; value: L } =>
    e.tag === "left",
  isRight: <L, R>(e: Either<L, R>): e is { tag: "right"; value: R } =>
    e.tag === "right",
  fold: <L, R, T>(
    either: Either<L, R>,
    onLeft: (l: L) => T,
    onRight: (r: R) => T,
  ): T =>
    either.tag === "left" ? onLeft(either.value) : onRight(either.value),
  map: <L, R, U>(either: Either<L, R>, fn: (r: R) => U): Either<L, U> =>
    either.tag === "right"
      ? Either.right(fn(either.value))
      : (either as Either<L, U>),
  bind: <L, R, U>(
    either: Either<L, R>,
    fn: (r: R) => Either<L, U>,
  ): Either<L, U> =>
    either.tag === "right" ? fn(either.value) : (either as Either<L, U>),
};

export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E;
export function pipe(initial: unknown, ...fns: Function[]): unknown {
  return fns.reduce((acc, fn) => fn(acc), initial);
}

export function compose<A, B>(ab: (a: A) => B): (a: A) => B;
export function compose<A, B, C>(
  bc: (b: B) => C,
  ab: (a: A) => B,
): (a: A) => C;
export function compose<A, B, C, D>(
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B,
): (a: A) => D;
export function compose(...fns: Function[]): Function {
  return (input: unknown) => fns.reduceRight((acc, fn) => fn(acc), input);
}

export const curry =
  <A, B, C>(fn: (a: A, b: B) => C) =>
  (a: A) =>
  (b: B): C =>
    fn(a, b);

export const curry3 =
  <A, B, C, D>(fn: (a: A, b: B, c: C) => D) =>
  (a: A) =>
  (b: B) =>
  (c: C): D =>
    fn(a, b, c);

export const identity = <T>(x: T): T => x;

export const constant =
  <T>(x: T) =>
  (): T =>
    x;

export const unwrapOrDefault =
  <T>(defaultValue: T) =>
  (value: T | null | undefined): T =>
    value ?? defaultValue;

export const unwrapOrThrow =
  (errorFactory: () => Error) =>
  <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw errorFactory();
    return value;
  };

export class TelemetryCollector {
  private static instance: TelemetryCollector;
  private readonly eventBuffer: Array<{
    event: string;
    entityId: string | number;
    meta: Record<string, unknown>;
    ts: number;
  }> = [];

  private constructor() {}

  static shared(): TelemetryCollector {
    if (!TelemetryCollector.instance) {
      TelemetryCollector.instance = new TelemetryCollector();
    }
    return TelemetryCollector.instance;
  }

  record(
    event: string,
    entityId: string | number,
    meta: Record<string, unknown> = {},
  ): void {
    this.eventBuffer.push({ event, entityId, meta, ts: Date.now() });
    console.log(
      `[Telemetry] ${event} | entity=${entityId} | ${JSON.stringify(meta)}`,
    );
    if (this.eventBuffer.length > 1000) this.eventBuffer.splice(0, 500);
  }

  drain(): typeof this.eventBuffer {
    return this.eventBuffer.splice(0);
  }
}
