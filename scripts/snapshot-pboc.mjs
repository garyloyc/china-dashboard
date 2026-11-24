import { access, writeFile } from 'node:fs/promises'

const BASE = 'https://www.pbc.gov.cn'
const LIST = '/zhengcehuobisi/125207/125213/125431/125475'
const SOURCE = 'http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html'
const headers = { 'User-Agent': 'Mozilla/5.0' }
const TENOR_KEYS = ['on', 'd7', 'd14']

const savedCopy = new URL('../public/pboc-omo.json', import.meta.url)

function cutoffDate() {
  const shanghai = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const year = shanghai.getUTCFullYear() - 2
  const month = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shanghai.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function getText(path) {
  let lastError = new Error(`No response for ${path}`)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${path}`, { headers })
      if (!response.ok) throw new Error(`${response.status} ${path}`)
      return await response.text()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
  throw lastError
}

function listItems(html) {
  const items = []
  const pattern =
    /href="(\/zhengcehuobisi\/125207\/125213\/125431\/125475\/\d+\/index\.html)"[\s\S]*?hui12">(\d{4}-\d{2}-\d{2})/g
  for (const match of html.matchAll(pattern)) items.push({ path: match[1], date: match[2] })
  return items
}

function tenorKey(label) {
  if (label.includes('买断')) return null
  if (label.includes('14天')) return 'd14'
  if (label.includes('隔夜') || label.includes('1天')) return 'on'
  if (label.includes('7天')) return 'd7'
  return 'other'
}

function addTenor(parts, label, amount) {
  const key = tenorKey(label)
  if (key == null || key === 'other') return false
  parts[key] = (parts[key] ?? 0) + amount
  return true
}

function tableTenors(compact, parts) {
  const start = compact.indexOf('逆回购操作情况')
  if (start < 0) return false
  const section = compact.slice(start, start + 480)
  const row =
    /(14天|7天|隔夜|1天)(?:期)?(?:([\d,]+(?:\.\d+)?)亿元(\d+(?:\.\d+)?)%|(\d+(?:\.\d+)?)%([\d,]+(?:\.\d+)?)亿元(?:([\d,]+(?:\.\d+)?)亿元)?)/g
  let found = false
  for (const match of section.matchAll(row)) {
    const raw = match[2] ?? match[6] ?? match[5]
    if (!raw) continue
    if (addTenor(parts, match[1], Number(raw.replace(/,/g, '')))) found = true
  }
  return found
}

function injectionParts(body) {
  const compact = body.replace(/\s+/g, '')
  if (!compact.includes('逆回购')) return null
  const parts = { on: null, d7: null, d14: null }
  const unknown = []
  let labeled = false
  for (const match of compact.matchAll(/开展了([\d,]+(?:\.\d+)?)亿元([^。]{0,24}?)逆回购/g)) {
    const key = tenorKey(match[2])
    if (key == null) continue
    if (key === 'other') {
      if (match[2]) unknown.push(match[2])
      continue
    }
    addTenor(parts, match[2], Number(match[1].replace(/,/g, '')))
    labeled = true
  }
  if (!labeled) tableTenors(compact, parts)
  for (const match of compact.matchAll(/(14天期|7天期|隔夜期|隔夜|1天期)逆回购操作量为零/g)) {
    const key = tenorKey(match[1])
    if (key == null || key === 'other') continue
    if (parts[key] == null) parts[key] = 0
  }
  const found = TENOR_KEYS.some((key) => parts[key] != null)
  return { parts, found, unknown }
}

function articleBody(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
  const start = text.indexOf('文章来源')
  return text.slice(start > 0 ? start : 0, (start > 0 ? start : 0) + 1800)
}

async function keepSavedCopy(reason) {
  try {
    await access(savedCopy)
    console.warn(`PBOC refresh failed (${reason}). Keeping the saved copy.`)
  } catch {
    throw new Error(reason)
  }
}

try {
  await refresh()
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  await keepSavedCopy(reason)
}

async function refresh() {
  const from = cutoffDate()
  const notices = []
  for (let page = 1; page <= 80; page += 1) {
    const path = page === 1 ? `${LIST}/index.html` : `${LIST}/17081-${page}.html`
    const items = listItems(await getText(path))
    if (items.length === 0) break
    notices.push(...items)
    const oldest = items.at(-1)?.date
    console.log(`page ${page} ${items[0]?.date} ${oldest}`)
    if (oldest && oldest < from) break
  }

  const windowNotices = notices.filter((item) => item.date >= from)
  const byDate = new Map()
  let cursor = 0
  const missed = []
  const unknown = []

  async function worker() {
    while (cursor < windowNotices.length) {
      const item = windowNotices[cursor]
      cursor += 1
      const parsed = injectionParts(articleBody(await getText(item.path)))
      if (!parsed) continue
      if (parsed.unknown.length > 0) unknown.push(`${item.date} ${parsed.unknown.join('|')}`)
      if (!parsed.found) {
        missed.push(item.date)
        continue
      }
      const current = byDate.get(item.date) ?? { on: null, d7: null, d14: null }
      for (const key of TENOR_KEYS) {
        if (parsed.parts[key] == null) continue
        current[key] = (current[key] ?? 0) + parsed.parts[key]
      }
      byDate.set(item.date, current)
    }
  }

  await Promise.all(Array.from({ length: 6 }, worker))
  if (missed.length > 0) console.warn('Unparsed reverse-repo notices', missed.join(', '))
  if (unknown.length > 0) console.warn('Unclassified tenor', unknown.join(', '))

  const days = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, parts]) => {
      const day = { date }
      for (const key of TENOR_KEYS) if (parts[key] != null) day[key] = parts[key]
      return day
    })

  const snapshot = {
    asOf: new Date().toISOString(),
    source: SOURCE,
    unit: '亿元',
    from,
    days,
  }

  await writeFile(savedCopy, JSON.stringify(snapshot))
  const counts = Object.fromEntries(TENOR_KEYS.map((key) => [key, days.filter((day) => day[key] != null).length]))
  console.log(`Saved ${days.length} PBOC injection days from ${from}`, counts)
}
