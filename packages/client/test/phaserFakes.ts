// Minimal stand-ins for the Phaser objects the scenes touch, so scene methods
// can run under vitest without a canvas. Every unknown method is chainable and
// recorded; a few setters also mirror their value onto the fake for assertions.

export interface FakeCall {
  method: string;
  args: unknown[];
}

export interface FakeObject {
  readonly calls: FakeCall[];
  [key: string]: unknown;
}

const MIRRORED: Record<string, string> = {
  setText: 'text',
  setVisible: 'visible',
  setColor: 'color',
  setTint: 'tint',
  setRotation: 'rotation',
};

function mirror(target: Record<string, unknown>, method: string, args: unknown[]): void {
  if (method in MIRRORED) target[MIRRORED[method]] = args[0];
  else if (method === 'setPosition') Object.assign(target, { x: args[0], y: args[1] });
  else if (method === 'clearTint') target.tint = undefined;
  else if (method === 'destroy') target.destroyed = true;
}

export function fakeObject(props: Record<string, unknown> = {}): FakeObject {
  const state: Record<string, unknown> = { calls: [], ...props };
  const proxy = new Proxy(state, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (key in target) return target[key];
      if (key === 'then') return undefined; // not a thenable
      return (...args: unknown[]) => {
        (target.calls as FakeCall[]).push({ method: key, args });
        mirror(target, key, args);
        return proxy;
      };
    },
  });
  return proxy as FakeObject;
}

/** Names of the methods called on a fake, in order. */
export const methodsCalled = (o: FakeObject): string[] => o.calls.map((c) => c.method);

/** `scene.add` stand-in: every factory call returns a fresh fake, remembered in `created`. */
export function fakeFactory(): { add: FakeObject; created: FakeObject[] } {
  const created: FakeObject[] = [];
  const add = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === 'symbol') return undefined;
        return (...args: unknown[]) => {
          const props: Record<string, unknown> = { factory: key, args };
          if (key === 'text') props.text = args[2];
          if (key === 'circle') props.fillColor = args[3];
          const o = fakeObject(props);
          created.push(o);
          return o;
        };
      },
    },
  );
  return { add: add as FakeObject, created };
}

type Handler = (...args: unknown[]) => void;

/** Tiny event emitter matching the on/once/off/emit(context) shape scenes use. */
export class FakeEmitter {
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  private readonly handlers = new Map<string, Array<{ fn: Handler; ctx: unknown }>>();

  on(event: string, fn: Handler, ctx?: unknown): this {
    const list = this.handlers.get(event) ?? [];
    list.push({ fn, ctx });
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, fn: Handler, ctx?: unknown): this {
    return this.on(event, fn, ctx);
  }

  off(event: string, fn: Handler): this {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h.fn !== fn),
    );
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    this.emitted.push({ event, args });
    for (const { fn, ctx } of this.handlers.get(event) ?? []) fn.apply(ctx, args);
    return true;
  }

  /** Payloads of every emit of `event`, oldest first. */
  payloads(event: string): unknown[][] {
    return this.emitted.filter((e) => e.event === event).map((e) => e.args);
  }
}
