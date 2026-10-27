import type { ParentalConsentProvider, ParentalConsentProviderResult, ParentalConsentStartInput } from '@consenti/types'
import { randomUUID } from 'node:crypto'

export interface MockParentalConsentProviderOptions {
  /** Verify every request as soon as it starts. Default: false (call `approve()`). */
  autoApprove?: boolean
  /** The mock refuses to run with NODE_ENV=production unless this is true. */
  allowInProduction?: boolean
}

/**
 * For development and tests only: performs no verification at all. Requests stay `pending`
 * until `approve(ref)` or `reject(ref)` is called (or are verified at once with `autoApprove`).
 * Use it to build and test the flow, then swap in a real provider.
 */
export class MockParentalConsentProvider implements ParentalConsentProvider {
  readonly id = 'mock'
  private sessions = new Map<string, ParentalConsentProviderResult>()

  constructor(private options: MockParentalConsentProviderOptions = {}) {
    if (process.env['NODE_ENV'] === 'production' && !options.allowInProduction) {
      throw new Error('[ijazat] MockParentalConsentProvider performs no verification and must not be used in production.')
    }
  }

  async start(_input: ParentalConsentStartInput): Promise<ParentalConsentProviderResult> {
    const providerRef = `mock_${randomUUID()}`
    const result: ParentalConsentProviderResult = {
      status: this.options.autoApprove ? 'verified' : 'pending',
      providerRef,
      message: 'Test mode: no verification is performed.',
      method: 'mock',
    }
    this.sessions.set(providerRef, result)
    return { ...result }
  }

  async check(providerRef: string): Promise<ParentalConsentProviderResult> {
    return { ...(this.sessions.get(providerRef) ?? { status: 'failed', providerRef, message: 'Unknown request' }) }
  }

  approve(providerRef: string): void { this.set(providerRef, 'verified') }
  reject(providerRef: string): void { this.set(providerRef, 'failed') }

  private set(providerRef: string, status: 'verified' | 'failed'): void {
    const s = this.sessions.get(providerRef)
    if (!s) throw new Error(`Unknown mock request ${providerRef}`)
    this.sessions.set(providerRef, { ...s, status })
  }
}
