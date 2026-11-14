import type { HandlerGroup } from '../dispatch/handler-group-manifest'
import { RELAY_COMMAND_SPECS } from '../specs/relay'

export const RELAY_HANDLER_GROUP: HandlerGroup = {
  name: 'relay',
  keys: RELAY_COMMAND_SPECS.map((spec) => spec.path.join(' ')),
  load: async () => (await import('./relay-host-id.js')).RELAY_HANDLERS
}
