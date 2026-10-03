export type Ttl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      /** When the main thread last sent a request that got a response, ms since the epoch. */
      lastAt: number | null
      /** The model that request named; a different one starts a cache of its own. */
      lastModel: string | null
      /** The lifetime `auto` has settled on so far. */
      learnedTtl: Ttl
    }
  }
}
