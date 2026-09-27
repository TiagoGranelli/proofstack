// Stands in for `@tanstack/devtools-event-client` in production builds (`resolve.alias` in vite.config.ts), for the
// browser and the server alike.
//
// TanStack Form's core imports the devtools event client unconditionally and creates it at module load, with no
// production guard (TanStack/form#2132, open for @tanstack/form-core 1.33.5 and devtools-event-client 0.4.4). Its
// first `emit`, which rendering any form makes, starts a `setInterval` that retries connecting to a devtools bus
// every second, five times. On the server nothing ever answers, and that timer kept the process alive for about
// 5 s after SIGTERM instead of 1 s once a form page had been rendered (tests/integration/no-devtools.test.ts).
// The app ships no TanStack devtools, so the production build gets this silent client instead; `pnpm dev` keeps
// the real one. Remove the alias and this file when form-core guards its devtools client.

type Unsubscribe = () => void

/** The event client's public surface, with nothing behind it: events go nowhere and no listener is ever called. */
export class EventClient {
  readonly #pluginId: string

  constructor(options: { readonly pluginId: string }) {
    this.#pluginId = options.pluginId
  }

  getPluginId(): string {
    return this.#pluginId
  }

  createEventPayload<Payload>(
    eventSuffix: string,
    payload: Payload,
  ): { type: string; payload: Payload; pluginId: string } {
    return { type: `${this.#pluginId}:${eventSuffix}`, payload, pluginId: this.#pluginId }
  }

  emit(): void {}

  on(): Unsubscribe {
    return () => {}
  }

  onAll(): Unsubscribe {
    return () => {}
  }

  onAllPluginEvents(): Unsubscribe {
    return () => {}
  }
}
