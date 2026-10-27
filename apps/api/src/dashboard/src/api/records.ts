import { apiFetch } from './client'
import type {
  ServerConsentReceipt, NoticeVersion, ErasureRequest, ErasureRequestStatus, ErasureRequestChannel,
  RetentionPolicy, RetentionRunResult, PagedResult,
} from '@consenti/types'

export type ReceiptRow = ServerConsentReceipt & { verified: boolean }
export type ErasureList = PagedResult<ErasureRequest> & { open: number; overdue: number; now: string }

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return q.toString()
}

export const recordsApi = {
  receipts: (p: { page: number; limit: number; visitorId?: string; action?: string }) =>
    apiFetch<PagedResult<ReceiptRow>>(`/receipts?${qs(p)}`),
  noticeVersions: (p: { page: number; limit: number; profileId?: string }) =>
    apiFetch<PagedResult<NoticeVersion>>(`/notice-versions?${qs(p)}`),
  erasureRequests: (p: { page: number; limit: number; status?: string }) =>
    apiFetch<ErasureList>(`/erasure-requests?${qs(p)}`),
  createErasureRequest: (body: { channel: ErasureRequestChannel; contact?: string; visitorId?: string; message?: string }) =>
    apiFetch<ErasureRequest>('/erasure-requests', { method: 'POST', body: JSON.stringify(body) }),
  updateErasureRequest: (id: string, body: { status: ErasureRequestStatus; note?: string; eraseConsent?: boolean }) =>
    apiFetch<ErasureRequest>(`/erasure-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  policy: () => apiFetch<RetentionPolicy>('/retention/policy'),
  savePolicy: (policy: RetentionPolicy) => apiFetch<RetentionPolicy>('/retention/policy', { method: 'PUT', body: JSON.stringify(policy) }),
  runRetention: (dryRun: boolean) => apiFetch<RetentionRunResult>('/retention/run', { method: 'POST', body: JSON.stringify({ dryRun }) }),
}
