export type Ttl = '5m' | '1h'

/** The main thread's last request that got a response. */
export type LastResponse = {
  /** When it was sent, ms since the epoch. */
  at: number
  /** The model that answered, null when unknown (a resumed session); a different one starts a cache of its own. */
  model: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      last: LastResponse | null
      /** The lifetime `auto` has settled on so far. */
      learnedTtl: Ttl
    }
  }
}
