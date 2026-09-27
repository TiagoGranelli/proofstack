import '@tanstack/react-start/server-only'

type Cleanup = () => Promise<void> | void

// Nitro plugins and the Start SSR bundle can be separate module instances,
// so the registry lives on globalThis rather than in module scope.
const registry = ((globalThis as { __proofstackShutdown?: Map<string, Cleanup> }).__proofstackShutdown ??= new Map())

/** Registers a named cleanup that runs once when the server receives SIGTERM/SIGINT. */
export const onShutdown = (name: string, cleanup: Cleanup) => {
  registry.set(name, cleanup)
}
