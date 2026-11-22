export const TENORS = [
  { key: 'y1', label: '1 year or below', color: '#8d907f' },
  { key: 'y3', label: 'Over 1y to 3y', color: '#c6a15a' },
  { key: 'y5', label: 'Over 3y to 5y', color: '#e4d2a4' },
  { key: 'y7', label: 'Over 5y to 7y', color: '#7dba6a' },
  { key: 'y10', label: 'Over 7y to 10y', color: '#6a9eae' },
  { key: 'y10p', label: 'Over 10 years', color: '#e07a62' },
] as const

export type TenorKey = (typeof TENORS)[number]['key']

export type YearBucket = {
  year: number
  count: number
  issued: number
  outstanding: number
  byTenor: Record<TenorKey, number>
}

export type TenorTotal = {
  key: TenorKey
  label: string
  color: string
  count: number
  issued: number
  outstanding: number
}

export type HkmaMonth = {
  month: string
  total: number
  byTenor: Record<TenorKey, number>
}

export type CnhBook = {
  years: YearBucket[]
  tenors: TenorTotal[]
  issueCount: number
  issued: number
  outstanding: number
  hkma: HkmaMonth[]
  loadedAt: number
  cmuAsOf: string
}

type CmuRecord = {
  cmu_iss_date?: string
  cmu_mat_date?: string
  cmu_iss_cur?: string
  cmu_iss_siz?: number | string
  cmu_issoutstd_amt?: number | string
}

type HkmaRecord = {
  end_of_month: string
  fixed_rate_1y_or_below?: number
  fixed_rate_1yto3y?: number
  fixed_rate_3yto5y?: number
  fixed_rate_5yto7y?: number
  fixed_rate_7y?: number
  floating_rate_1y_or_below?: number
  floating_rate_1yto3y?: number
  floating_rate_3yto5y?: number
  floating_rate_5yto7y?: number
  floating_rate_7y?: number
  total?: number
}

const emptyTenor = (): Record<TenorKey, number> => ({
  y1: 0,
  y3: 0,
  y5: 0,
  y7: 0,
  y10: 0,
  y10p: 0,
})

export function tenorKey(years: number): TenorKey {
  if (years <= 1) return 'y1'
  if (years <= 3) return 'y3'
  if (years <= 5) return 'y5'
  if (years <= 7) return 'y7'
  if (years <= 10) return 'y10'
  return 'y10p'
}

function originalTenorYears(issueDate: string, maturityDate: string): number | null {
  const issue = Date.parse(issueDate)
  const maturity = Date.parse(maturityDate)
  if (Number.isNaN(issue) || Number.isNaN(maturity) || maturity <= issue) return null
  return (maturity - issue) / (365.25 * 24 * 60 * 60 * 1000)
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} from ${url}`)
  const text = (await response.text()).replace(/^\uFEFF/, '')
  return JSON.parse(text) as unknown
}

const HKMA_URL =
  'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/efbn/cmu-outstanding-remain-tenor-rmb'

export type SavedIssue = {
  issueDate: string
  maturityDate: string
  issued: number
  outstanding: number
}

async function fetchCmuIssues(): Promise<{ issues: SavedIssue[]; asOf: string }> {
  if (import.meta.env.DEV) {
    const payload = (await readJson('/cmu/api/data_statistics_search.php?search_type=8026')) as {
      result?: { records?: CmuRecord[] }
    }
    const issues = (payload.result?.records ?? [])
      .filter((record) => record.cmu_iss_cur === 'CNY')
      .map((record) => ({
        issueDate: record.cmu_iss_date ?? '',
        maturityDate: record.cmu_mat_date ?? '',
        issued: Number(record.cmu_iss_siz) || 0,
        outstanding: Number(record.cmu_issoutstd_amt) || 0,
      }))
    return { issues, asOf: new Date().toISOString() }
  }

  const saved = (await readJson(`${import.meta.env.BASE_URL}cnh-cmu.json`)) as {
    asOf?: string
    issues?: SavedIssue[]
  }
  return { issues: saved.issues ?? [], asOf: saved.asOf ?? '' }
}

async function fetchHkma(): Promise<HkmaRecord[]> {
  const records: HkmaRecord[] = []
  const hkmaBase = import.meta.env.DEV ? '/hkma/public/market-data-and-statistics/monthly-statistical-bulletin/efbn/cmu-outstanding-remain-tenor-rmb' : HKMA_URL
  for (let offset = 0; offset < 1000; offset += 100) {
    const payload = (await readJson(`${hkmaBase}?offset=${offset}`)) as {
      result?: { records?: HkmaRecord[] }
    }
    const page = payload.result?.records ?? []
    records.push(...page)
    if (page.length < 100) break
  }
  return records
}

function hkmaTenor(record: HkmaRecord): Record<TenorKey, number> {
  const add = (fixed?: number, floating?: number) => (fixed ?? 0) + (floating ?? 0)
  return {
    y1: add(record.fixed_rate_1y_or_below, record.floating_rate_1y_or_below),
    y3: add(record.fixed_rate_1yto3y, record.floating_rate_1yto3y),
    y5: add(record.fixed_rate_3yto5y, record.floating_rate_3yto5y),
    y7: add(record.fixed_rate_5yto7y, record.floating_rate_5yto7y),
    y10: add(record.fixed_rate_7y, record.floating_rate_7y),
    y10p: 0,
  }
}

export async function loadCnhBook(): Promise<CnhBook> {
  const [{ issues, asOf }, hkmaRecords] = await Promise.all([fetchCmuIssues(), fetchHkma()])
  const cny = issues.map((issue) => ({
    cmu_iss_date: issue.issueDate,
    cmu_mat_date: issue.maturityDate,
    cmu_iss_siz: issue.issued,
    cmu_issoutstd_amt: issue.outstanding,
  }))
  const byYear = new Map<number, YearBucket>()
  const tenorTotals = new Map<TenorKey, TenorTotal>(
    TENORS.map((tenor) => [tenor.key, { ...tenor, count: 0, issued: 0, outstanding: 0 }]),
  )

  let issued = 0
  let outstanding = 0

  for (const record of cny) {
    const issueDate = record.cmu_iss_date ?? ''
    const year = Number(issueDate.slice(0, 4))
    if (!Number.isInteger(year)) continue
    const amount = Number(record.cmu_iss_siz) || 0
    const stillOut = Number(record.cmu_issoutstd_amt) || 0
    const tenorYears = originalTenorYears(issueDate, record.cmu_mat_date ?? '')
    const key = tenorYears == null ? null : tenorKey(tenorYears)

    issued += amount
    outstanding += stillOut

    const bucket = byYear.get(year) ?? {
      year,
      count: 0,
      issued: 0,
      outstanding: 0,
      byTenor: emptyTenor(),
    }
    bucket.count += 1
    bucket.issued += amount
    bucket.outstanding += stillOut
    if (key) bucket.byTenor[key] += amount
    byYear.set(year, bucket)

    if (key) {
      const total = tenorTotals.get(key)
      if (total) {
        total.count += 1
        total.issued += amount
        total.outstanding += stillOut
      }
    }
  }

  const hkma = hkmaRecords
    .filter((record) => record.end_of_month)
    .map((record) => ({
      month: record.end_of_month,
      total: record.total ?? 0,
      byTenor: hkmaTenor(record),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    years: [...byYear.values()].sort((a, b) => a.year - b.year),
    tenors: TENORS.map((tenor) => tenorTotals.get(tenor.key)!),
    issueCount: cny.length,
    issued,
    outstanding,
    hkma,
    loadedAt: Date.now(),
    cmuAsOf: asOf,
  }
}

export function billion(cny: number): string {
  return (cny / 1_000_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export function millionToBillion(rmbMillion: number): string {
  return (rmbMillion / 1_000).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}
