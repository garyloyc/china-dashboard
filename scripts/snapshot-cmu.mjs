const response = await fetch('https://www.CMUOmniClear.com/api/data_statistics_search.php?search_type=8026', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
})
if (!response.ok) throw new Error(`CMU snapshot failed: ${response.status}`)
const text = (await response.text()).replace(/^\uFEFF/, '')
const payload = JSON.parse(text)
const issues = (payload.result?.records ?? [])
  .filter((record) => record.cmu_iss_cur === 'CNY')
  .map((record) => ({
    issueDate: record.cmu_iss_date ?? '',
    maturityDate: record.cmu_mat_date ?? '',
    issued: Number(record.cmu_iss_siz) || 0,
    outstanding: Number(record.cmu_issoutstd_amt) || 0,
  }))

const snapshot = {
  asOf: new Date().toISOString(),
  source: 'https://www.CMUOmniClear.com/api/data_statistics_search.php?search_type=8026',
  issues,
}

await import('node:fs/promises').then(({ writeFile }) =>
  writeFile(new URL('../public/cnh-cmu.json', import.meta.url), JSON.stringify(snapshot)),
)
console.log(`Saved ${issues.length} CNY issues`)
