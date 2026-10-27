import type { ConsentManagerAdapter, ConsentManagerArtefact, ConsentManagerEvent } from '@consenti/types'
import { createHmac, timingSafeEqual } from 'node:crypto'

const HEADER = 'x-mock-cm-signature'

export interface MockConsentManagerOptions {
  /** Shared secret the mock signs notifications with. */
  secret: string
  /** The mock refuses to run with NODE_ENV=production unless this is true. */
  allowInProduction?: boolean
}

/**
 * For development and tests only: stands in for a registered Consent Manager. Notifications are
 * JSON `ConsentManagerEvent`s signed with HMAC-SHA256 in the `x-mock-cm-signature` header; build
 * them with `notification()`. Real Consent Managers define their own formats; write an adapter
 * per Consent Manager against the `ConsentManagerAdapter` interface.
 */
export class MockConsentManager implements ConsentManagerAdapter {
  readonly id = 'mock'
  readonly name = 'Mock Consent Manager (development only)'
  private artefacts = new Map<string, ConsentManagerArtefact>()

  constructor(private options: MockConsentManagerOptions) {
    if (!options.secret) throw new Error('MockConsentManager needs a secret')
    if (process.env['NODE_ENV'] === 'production' && !options.allowInProduction) {
      throw new Error('[ijazat] MockConsentManager is for development only and must not be used in production.')
    }
  }

  /** A signed notification as the Consent Manager would send it. */
  notification(event: ConsentManagerEvent): { headers: Record<string, string>; body: string } {
    const body = JSON.stringify(event)
    this.artefacts.set(event.artefact.artefactId, event.artefact)
    return { headers: { 'content-type': 'application/json', [HEADER]: this.sign(body) }, body }
  }

  async verifyNotification(request: { headers: Record<string, string>; body: string }): Promise<ConsentManagerEvent> {
    const given = Buffer.from(request.headers[HEADER] ?? '', 'hex')
    const expected = Buffer.from(this.sign(request.body), 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('Invalid signature')
    return JSON.parse(request.body) as ConsentManagerEvent
  }

  async fetchArtefact(artefactId: string): Promise<ConsentManagerArtefact | null> {
    return this.artefacts.get(artefactId) ?? null
  }

  private sign(body: string): string {
    return createHmac('sha256', this.options.secret).update(body).digest('hex')
  }
}
