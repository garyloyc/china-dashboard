import { useCallback, useEffect, useMemo, useState } from 'react'
import { TENORS, billion, loadCnhBook, millionToBillion, type CnhBook, type TenorKey, type YearBucket } from './cnh.ts'

const CMU_SOURCE = 'https://www.cmuomniclear.com/en/securities-search'
const HKMA_SOURCE = 'https://www.hkma.gov.hk/eng/data-publications-and-research/data-and-statistics/monthly-statistical-bulletin/'
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setBook(await loadCnhBook())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The CMU feed did not load.')
    } finally {
      setLoading(false)
    }
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
            <p>Used for the year chart, tenor table, and the two CMU totals</p>
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
            <p>Used for the HKMA total, remaining tenor, and the history line</p>
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
              <p>{latestHkma ? `Remaining tenor at ${latestHkma.month}` : 'Remaining tenor'}</p>
              <h2>Outstanding stock</h2>
            </div>
          </div>
          {latestHkma && <TenorBars amounts={latestHkma.byTenor} scale={latestHkma.total} />}
          <p className="unit">HKMA live link, RMB billion. The over-7-year bucket is one published series.</p>
          {history.length > 0 && <OutstandingHistory points={history} />}
        </div>
      </section>
    </div>
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

function TenorBars({ amounts, scale }: { amounts: Record<TenorKey, number>; scale: number }) {
  return (
    <ul className="bars">
      {TENORS.filter((tenor) => tenor.key !== 'y10p').map((tenor) => {
        const value = amounts[tenor.key]
        const width = scale > 0 ? (value / scale) * 100 : 0
        return (
          <li key={tenor.key}>
            <span>{tenor.key === 'y10' ? 'Over 7 years' : tenor.label}</span>
            <span className="track">
              <i style={{ width: `${width}%`, background: tenor.color }} />
            </span>
            <strong>{millionToBillion(value)}</strong>
          </li>
        )
      })}
    </ul>
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
