import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runScan } from '../scan.js'
import { scanDirPath } from '../scan-dir.js'
import { generateScanId } from '../scan-id.js'
import type { ScanOptions, ScanProgressHandler, ScanReport, ScanRunControl } from '../types.js'
import { evaluateDpdp } from './checks.js'
import { renderDpdpHtml } from './html.js'
import { probeDpdpPage } from './probe.js'
import type { DpdpPageProbe, DpdpReport } from './types.js'

export interface DpdpCheckOptions extends ScanOptions {
  /** How many of the scanned pages get the DPDP probes (each costs three page loads). Default 3. */
  dpdpProbePages?: number
}

export interface DpdpCheckResultBundle {
  scan: ScanReport
  probes: DpdpPageProbe[]
  report: DpdpReport
}

/**
 * The DPDP consent checker: the regular three-state tracker scan, then the DPDP probes on the
 * first `dpdpProbePages` scanned pages, then `evaluateDpdp()`. Runs entirely on this machine —
 * the only network traffic is the crawl of the site itself.
 */
export async function runDpdpCheck(
  startUrl: string,
  options: DpdpCheckOptions,
  onProgress?: ScanProgressHandler,
  control?: ScanRunControl,
): Promise<DpdpCheckResultBundle> {
  const notify = onProgress ?? ((): void => {})
  const scanId = control?.scanId ?? generateScanId()
  const scan = await runScan(startUrl, options, notify, { ...control, scanId })

  const probes: DpdpPageProbe[] = []
  const pages = scan.pagesScanned.slice(0, Math.max(1, options.dpdpProbePages ?? 3))
  for (const url of pages) {
    if (control?.signal?.aborted) break
    notify(`DPDP checks: ${url}`)
    probes.push(await probeDpdpPage(url, options))
  }

  return { scan, probes, report: evaluateDpdp(scan, probes) }
}

/** Writes `dpdp-report.json` and `dpdp-report.html` into the scan's own directory. */
export async function writeDpdpReport(report: DpdpReport, outputDir: string): Promise<{ jsonPath: string; htmlPath: string }> {
  const dir = scanDirPath(outputDir, report.scanId)
  await mkdir(dir, { recursive: true })
  const jsonPath = join(dir, 'dpdp-report.json')
  const htmlPath = join(dir, 'dpdp-report.html')
  await writeFile(jsonPath, JSON.stringify(report, null, 2))
  await writeFile(htmlPath, renderDpdpHtml(report))
  return { jsonPath, htmlPath }
}
