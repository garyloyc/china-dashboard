import { useCallback, useEffect, useMemo, useState } from 'react'
import { TENORS, billion, loadCnhBook, millionToBillion, type CnhBook, type YearBucket } from './cnh.ts'

const CMU_SOURCE = 'https://www.cmuomniclear.com/en/securities-search'
const HKMA_SOURCE = 'https://www.hkma.gov.hk/eng/data-publications-and-research/data-and-statistics/monthly-statistical-bulletin/'
const PBOC_SOURCE = 'http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html'

type OmoTenor = 'total' | 'on' | 'd7' | 'd14'
type OmoDay = { date: string; on?: number; d7?: number; d14?: number }
type OmoBook = { asOf: string; from?: string; days: OmoDay[] }

const OMO_OPTIONS: { key: OmoTenor; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'd7', label: '7-day' },
  { key: 'on', label: 'O/N' },
  { key: 'd14', label: '14-day' },
]

function tenorAmount(day: OmoDay, tenor: OmoTenor): number | null {
  if (tenor === 'total') {
    const values = [day.on, day.d7, day.d14].filter((value): value is number => value != null)
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null
  }
  return day[tenor] ?? null
}

async function loadOmo(): Promise<OmoBook> {
  const response = await fetch(`${import.meta.env.BASE_URL}pboc-omo.json`)
  if (!response.ok) throw new Error(`PBOC file ${response.status}`)
  const payload = (await response.json()) as OmoBook
  return { asOf: payload.asOf ?? '', days: payload.days ?? [] }
}
const CMU_IS_SAVED = !import.meta.env.DEV

const SHANGHAI = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function yearEndSeries(book: CnhBook) {
  const byYear = new Map<number, { label: string; total: number }>()
  for (const point of book.hkma) {
    const year = Number(point.month.slice(0, 4))
    const current = byYear.get(year)
    if (!current || point.month > current.label) byYear.set(year, { label: point.month, total: point.total })
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, point]) => ({ year, month: point.label, total: point.total }))
}

export default function App() {
  const [book, setBook] = useState<CnhBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [omo, setOmo] = useState<OmoBook | null>(null)
  const [omoError, setOmoError] = useState<string | null>(null)
  const [omoTenor, setOmoTenor] = useState<OmoTenor>('total')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setOmoError(null)
    const [bookResult, omoResult] = await Promise.allSettled([loadCnhBook(), loadOmo()])
    if (bookResult.status === 'fulfilled') setBook(bookResult.value)
    else setError(bookResult.reason instanceof Error ? bookResult.reason.message : 'The CMU feed did not load.')
    if (omoResult.status === 'fulfilled') setOmo(omoResult.value)
    else setOmoError(omoResult.reason instanceof Error ? omoResult.reason.message : 'The PBOC file did not load.')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const latestHkma = book?.hkma.at(-1) ?? null
  const history = useMemo(() => (book ? yearEndSeries(book) : []), [book])
  const activeYear = book?.years.find((year) => year.year === selectedYear) ?? book?.years.at(-1) ?? null

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">CMU OmniClear · HKMA table 5.7.3</p>
          <h1>CNH issuance</h1>
        </div>
        <div className="status">
          <p>{book ? 'Sources are listed under the title' : 'Pulling CMU and HKMA'}</p>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Reloading' : 'Reload'}
          </button>
        </div>
      </header>

      <section className="sources" aria-label="Data sources">
        <article>
          <div className="source-top">
            <p>Used for the year chart, tenor table, CMU totals, and outstanding stock by remaining tenor</p>
            <span className={CMU_IS_SAVED ? 'badge saved' : 'badge live'}>{CMU_IS_SAVED ? 'Saved copy' : 'Live link'}</span>
          </div>
          <h2>CMU OmniClear, CNY</h2>
          <p>
            Public and private sector securities still lodged with CMU, currency code CNY. Each record has an issue date,
            a maturity date, an issue size, and an amount still outstanding. The file has no private-placement field, so
            the charts use the full CNY book. Matured issues drop out.
          </p>
          <p className="update">
            {CMU_IS_SAVED
              ? `Saved with this site${book?.cmuAsOf ? ` on ${SHANGHAI.format(new Date(book.cmuAsOf))} Shanghai` : ''}. A later month from CMU appears only after the site is published again. Reload reads this saved copy.`
              : `Read from CMU when this page opens${book?.cmuAsOf ? `, last read ${SHANGHAI.format(new Date(book.cmuAsOf))} Shanghai` : ''}.`}
          </p>
          <a href={CMU_SOURCE}>CMU securities search</a>
        </article>
        <article>
          <div className="source-top">
            <p>Used for the HKMA total and the history line</p>
            <span className="badge live">Live link</span>
          </div>
          <h2>HKMA table 5.7.3</h2>
          <p>
            Monthly Statistical Bulletin, outstanding amount of renminbi CMU issues by remaining tenor. Figures are RMB million
            in the source file and shown here in RMB billion.
          </p>
          <p className="update">
            Linked directly to HKMA. Every visit, including Reload, requests the current file. A new month shows up when HKMA
            publishes it.
            {latestHkma ? ` Latest month in this view: ${latestHkma.month}.` : ''}
          </p>
          <a href={HKMA_SOURCE}>HKMA Monthly Statistical Bulletin</a>
        </article>
        <article>
          <div className="source-top">
            <p>Used for the daily injection chart</p>
            <span className="badge saved">Saved copy</span>
          </div>
          <h2>PBOC open market</h2>
          <p>
            Open-market business announcements for the past two years. Each tenor is the accepted reverse-repo amount
            that day, in 亿元. Total adds overnight, 7-day, and 14-day when more than one is conducted. A notice that
            says that tenor’s amount is zero is plotted as zero. Hong Kong central-bank bill issuance is not counted.
            Maturing repos are not subtracted, so this is gross injection.
          </p>
          <p className="update">
            Saved with this site{omo?.asOf ? ` on ${SHANGHAI.format(new Date(omo.asOf))} Shanghai` : ''}. A new PBOC day
            appears after the site is published again. Reload reads this saved copy.
          </p>
          <a href={PBOC_SOURCE}>PBOC open-market announcements</a>
        </article>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="stats">
        <article>
          <p>Outstanding on CMU</p>
          <strong>{book ? `RMB ${billion(book.outstanding)} bn` : '…'}</strong>
          <span>{book ? `${book.issueCount.toLocaleString('en-US')} CNY issues still lodged` : 'CMU securities search'}</span>
        </article>
        <article>
          <p>Issued amount still lodged</p>
          <strong>{book ? `RMB ${billion(book.issued)} bn` : '…'}</strong>
          <span>Original issue size of that same book</span>
        </article>
        <article>
          <p>HKMA outstanding</p>
          <strong>{latestHkma ? `RMB ${millionToBillion(latestHkma.total)} bn` : '…'}</strong>
          <span>{latestHkma ? `Renminbi CMU issues, ${latestHkma.month}` : 'Monthly Statistical Bulletin'}</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p>Original tenor</p>
            <h2>Amount issued, by year</h2>
          </div>
          <p className="unit">{CMU_IS_SAVED ? 'CMU saved copy' : 'CMU live link'} · original issue size, RMB billion</p>
        </div>
        {book ? (
          <YearChart years={book.years} selected={activeYear?.year ?? null} onSelect={setSelectedYear} />
        ) : (
          <p className="pending">Waiting for CMU.</p>
        )}
        <ul className="legend">
          {TENORS.map((tenor) => (
            <li key={tenor.key}>
              <i style={{ background: tenor.color }} />
              {tenor.label}
            </li>
          ))}
        </ul>
        {activeYear && (
          <p className="year-readout">
            {activeYear.year}: {activeYear.count.toLocaleString('en-US')} issues, RMB {billion(activeYear.issued)} bn
            issued, RMB {billion(activeYear.outstanding)} bn still outstanding.
          </p>
        )}
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p>Original tenor of the lodged book</p>
              <h2>Issuance tenor</h2>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Issues</th>
                <th>Issued</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(book?.tenors ?? []).map((tenor) => (
                <tr key={tenor.key}>
                  <th scope="row">
                    <i style={{ background: tenor.color }} />
                    {tenor.label}
                  </th>
                  <td>{tenor.count.toLocaleString('en-US')}</td>
                  <td>{billion(tenor.issued)}</td>
                  <td>{billion(tenor.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="unit">
            {CMU_IS_SAVED ? 'Same saved CMU copy.' : 'Same live CMU file.'} RMB billion. Tenor is maturity date minus issue date.
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p>Remaining tenor of the CMU book</p>
              <h2>Outstanding stock</h2>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Issues</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(book?.remaining ?? []).map((tenor) => (
                <tr key={tenor.key}>
                  <th scope="row">
                    <i style={{ background: tenor.color }} />
                    {tenor.label}
                  </th>
                  <td>{tenor.count.toLocaleString('en-US')}</td>
                  <td>{billion(tenor.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="unit">
            {CMU_IS_SAVED ? 'Saved CMU copy.' : 'Live CMU file.'} RMB billion. Remaining tenor is maturity date minus the
            copy date. HKMA publishes over 7 years as one series, so 7–10, 10–15, and over 15 are calculated from CMU.
          </p>
          {history.length > 0 && <OutstandingHistory points={history} />}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p>Daily reverse repo, past 2 years</p>
            <h2>Liquidity injection</h2>
          </div>
          <div className="omo-controls">
            <label>
              Tenor
              <select value={omoTenor} onChange={(event) => setOmoTenor(event.target.value as OmoTenor)}>
                {OMO_OPTIONS.filter((option) => option.key !== 'd14' || omo?.days.some((day) => day.d14 != null)).map(
                  (option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p className="unit">{omo ? omoSummary(omo.days, omoTenor) : 'PBOC saved copy'}</p>
          </div>
        </div>
        {omoError && <p className="error">{omoError}</p>}
        {omo ? <InjectionChart days={omo.days} tenor={omoTenor} /> : <p className="pending">Waiting for the PBOC copy.</p>}
        <p className="unit">
          亿元. Gross reverse-repo injection from the saved PBOC announcements. Total is overnight plus 7-day plus
          14-day. Not net of maturities.
        </p>
      </section>
    </div>
  )
}

function formatYi(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function omoSummary(days: OmoDay[], tenor: OmoTenor) {
  const points = days.flatMap((day) => {
    const amount = tenorAmount(day, tenor)
    return amount == null ? [] : [{ date: day.date, amount }]
  })
  const latest = points.at(-1)
  if (!latest) return 'No operations in this tenor'
  return `${points.length} days · latest ${latest.date} · ${formatYi(latest.amount)} 亿元`
}

function InjectionChart({ days, tenor }: { days: OmoDay[]; tenor: OmoTenor }) {
  const width = 920
  const height = 250
  const pad = { top: 16, right: 8, bottom: 28, left: 56 }
  const points = days.map((day) => ({ date: day.date, amount: tenorAmount(day, tenor) }))
  const max = Math.max(...points.map((day) => day.amount ?? 0), 1)
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const gap = points.length > 180 ? 0 : 1
  const barW = points.length > 0 ? Math.max((innerW - gap * (points.length - 1)) / points.length, 0.6) : 1
  const label = OMO_OPTIONS.find((option) => option.key === tenor)?.label ?? 'Total'

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} PBOC reverse-repo injection`}>
      {[0, 0.5, 1].map((share) => {
        const y = pad.top + innerH - share * innerH
        return (
          <g key={share}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="grid" />
            <text x={pad.left - 8} y={y + 4} className="tick" textAnchor="end">
              {formatYi(max * share)}
            </text>
          </g>
        )
      })}
      {points.map((day, index) => {
        const amount = day.amount ?? 0
        const h = day.amount == null ? 0 : (amount / max) * innerH
        const x = pad.left + index * (barW + gap)
        const y = pad.top + innerH - h
        const month = day.date.slice(0, 7)
        const showLabel = index === 0 || month !== points[index - 1]?.date.slice(0, 7)
        const yearStart = day.date.slice(5, 7) === '01' || index === 0
        return (
          <g key={day.date}>
            {day.amount != null && (
              <rect x={x} y={y} width={barW} height={Math.max(h, amount === 0 ? 1 : 0)} className="omo-bar">
                <title>{`${day.date} ${label}: ${formatYi(amount)} 亿元`}</title>
              </rect>
            )}
            {showLabel && (
              <text x={x + barW / 2} y={height - 8} className="tick year-label">
                {yearStart ? `${day.date.slice(2, 4)}/${day.date.slice(5, 7)}` : day.date.slice(5, 7)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function YearChart({
  years,
  selected,
  onSelect,
}: {
  years: YearBucket[]
  selected: number | null
  onSelect: (year: number) => void
}) {
  const width = 920
  const height = 320
  const pad = { top: 22, right: 8, bottom: 32, left: 64 }
  const max = Math.max(...years.map((year) => year.issued), 1)
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const gap = 8
  const barW = (innerW - gap * (years.length - 1)) / years.length

  const ticks = [0, 0.5, 1].map((share) => max * share)

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="CNY issuance by year and original tenor">
      {ticks.map((tick) => {
        const y = pad.top + innerH - (tick / max) * innerH
        return (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="grid" />
            <text x={pad.left - 8} y={y + 4} className="tick" textAnchor="end">
              {billion(tick)}
            </text>
          </g>
        )
      })}
      {years.map((year, index) => {
        let cursor = pad.top + innerH
        const x = pad.left + index * (barW + gap)
        return (
          <g key={year.year} onClick={() => onSelect(year.year)} className="bar-hit">
            <rect x={x} y={pad.top} width={barW} height={innerH} fill="transparent" />
            {TENORS.map((tenor) => {
              const value = year.byTenor[tenor.key]
              const h = (value / max) * innerH
              cursor -= h
              return <rect key={tenor.key} x={x} y={cursor} width={barW} height={h} fill={tenor.color} />
            })}
            {selected === year.year && (
              <rect x={x - 2} y={pad.top} width={barW + 4} height={innerH} className="selected" />
            )}
            <text x={x + barW / 2} y={height - 12} className="tick year-label">
              {year.year}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function OutstandingHistory({ points }: { points: { year: number; month: string; total: number }[] }) {
  const width = 460
  const height = 150
  const pad = { top: 12, right: 8, bottom: 24, left: 36 }
  const max = Math.max(...points.map((point) => point.total), 1)
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const coords = points.map((point, index) => {
    const x = pad.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW)
    const y = pad.top + innerH - (point.total / max) * innerH
    return { ...point, x, y }
  })
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')

  return (
    <div className="history">
      <p>Outstanding at each year-end, plus the latest month</p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="HKMA renminbi CMU outstanding amount">
        <path d={line} className="history-line" />
        {coords.map((point) => (
          <g key={point.month}>
            <circle cx={point.x} cy={point.y} r="2.5" />
            <text x={point.x} y={height - 6} className="tick year-label">
              {String(point.year).slice(2)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
