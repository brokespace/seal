// The Worker under test, with push provider traffic pointed at the local fake. Production has no
// such switch: the redirect exists only in this file, which no deploy bundles.
import relay, {
  SealHostRelay,
  SealMcpTunnel,
  SealPushHost as ProductionPushHost,
  SpliceRelay
} from '../src/index'

export { SealHostRelay, SealMcpTunnel, SpliceRelay }

export class SealPushHost extends ProductionPushHost {
  protected override providerUrl(url: string): string {
    const origin = (this.env as unknown as { TEST_PUSH_PROVIDER_ORIGIN: string })
      .TEST_PUSH_PROVIDER_ORIGIN
    const parsed = new URL(url)
    return `${origin}/${parsed.hostname}${parsed.pathname}`
  }
}

export default relay
