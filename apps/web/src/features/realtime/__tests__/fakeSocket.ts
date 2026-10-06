import type { ClientToServerEvents, ServerToClientEvents } from '@nexus/shared';
import type { AppSocket } from '@/lib/socket';

type AnyHandler = (...args: never[]) => void;

/** Minimal in-memory stand-in for the Socket.IO client used by the realtime bridge. */
export class FakeSocket {
  connected = true;
  active = true;
  readonly sent: Array<{ event: keyof ClientToServerEvents; args: unknown[] }> = [];
  private handlers = new Map<string, Set<AnyHandler>>();

  on(event: string, handler: AnyHandler): this {
    const set = this.handlers.get(event) ?? new Set<AnyHandler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  off(event: string, handler?: AnyHandler): this {
    if (!handler) this.handlers.delete(event);
    else this.handlers.get(event)?.delete(handler);
    return this;
  }

  /** Client → server emit (recorded for assertions). */
  emit(event: keyof ClientToServerEvents, ...args: unknown[]): this {
    this.sent.push({ event, args });
    return this;
  }

  connect(): this {
    this.connected = true;
    for (const h of this.handlers.get('connect') ?? []) (h as () => void)();
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  /** Server → client push: invokes the registered listeners. */
  serverEmit<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    for (const h of this.handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  asSocket(): AppSocket {
    return this as unknown as AppSocket;
  }
}
