import { access, writeFile } from 'node:fs/promises'

const BASE = 'https://www.pbc.gov.cn'
const LIST = '/zhengcehuobisi/125207/125213/125431/125475'
const SOURCE = 'http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html'
const headers = { 'User-Agent': 'Mozilla/5.0' }

const savedCopy = new URL('../public/pboc-omo.json', import.meta.url)

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

function injectionYi(body) {
  if (!body.includes('逆回购')) return null
  const amounts = [...body.matchAll(/开展了\s*([\d,]+(?:\.\d+)?)\s*亿元[^。]{0,48}?逆回购/g)].map((match) =>
    Number(match[1].replace(/,/g, '')),
  )
  if (amounts.length > 0) return amounts.reduce((sum, value) => sum + value, 0)
  if (/操作量为零|中标量\s*0\s*亿元/.test(body)) return 0
  return null
}

function articleBody(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
  const start = text.indexOf('文章来源')
  return text.slice(start > 0 ? start : 0, (start > 0 ? start : 0) + 900)
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
const notices = []
for (let page = 1; page <= 40; page += 1) {
  const path = page === 1 ? `${LIST}/index.html` : `${LIST}/17081-${page}.html`
  const items = listItems(await getText(path))
  if (items.length === 0) break
  notices.push(...items)
  const oldest = items.at(-1)?.date
  console.log(`page ${page} ${items[0]?.date} ${oldest}`)
  if (oldest && oldest < '2026-01-01') break
}

const year = notices.filter((item) => item.date.startsWith('2026'))
const byDate = new Map()
let cursor = 0
const missed = []

async function worker() {
  while (cursor < year.length) {
    const item = year[cursor]
    cursor += 1
    const amount = injectionYi(articleBody(await getText(item.path)))
    if (amount == null) {
      missed.push(item.date)
      continue
    }
    byDate.set(item.date, (byDate.get(item.date) ?? 0) + amount)
  }
}

await Promise.all(Array.from({ length: 5 }, worker))
if (missed.length > 0) console.warn('Unparsed reverse-repo notices', missed.join(', '))

const days = [...byDate.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([date, injection]) => ({ date, injection }))

const snapshot = {
  asOf: new Date().toISOString(),
  source: SOURCE,
  unit: '亿元',
  days,
}

await writeFile(savedCopy, JSON.stringify(snapshot))
console.log(`Saved ${days.length} PBOC injection days`)
}
