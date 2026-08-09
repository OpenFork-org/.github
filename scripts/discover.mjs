const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

const LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dart',
  'scala',
]
const PAGES = 2
const PER_PAGE = 100
const RECENT_DAYS = 90
const REQUEST_DELAY_MS = 2100
const MAX_RESULTS = 300

const EXCLUDE = /(awesome|docs|documentation|dotfiles|config|configs|scaffold|boilerplate|starter|template|tutorial|course|cheat-?sheet|playground|examples?|samples?|blog|notes?|wiki|manual|guide)([^a-z0-9]|$)/i

const API = 'https://api.github.com/search/repositories'

const pushedAfter = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)

const fs = await import('node:fs')
const filename = `discoveries/${today}.txt`

if (fs.existsSync(filename)) {
  console.log(`${filename} already exists, skipping`)
  process.exit(0)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function search(query, page) {
  const url = `${API}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${page}`
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'openfork-discover',
    Authorization: `Bearer ${TOKEN}`,
  }
  const res = await fetch(url, { headers })
  if (res.status === 403 && /rate limit/i.test((await res.text()) || '')) {
    console.warn('Rate limited, waiting 60s before retrying...')
    await sleep(60000)
    return search(query, page)
  }
  if (!res.ok) {
    throw new Error(`Search API error ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

function isCandidate(repo) {
  if (!repo.license) return false
  const haystack = `${repo.full_name} ${repo.description ?? ''}`
  return !EXCLUDE.test(haystack)
}

const seen = new Map()
const stats = new Map()

for (const language of LANGUAGES) {
  const query = `has:readme stars:1..20 size:>0 fork:false pushed:>=${pushedAfter} language:${language}`
  let pageTotal = 0
  for (let page = 1; page <= PAGES; page++) {
    const data = await search(query, page)
    if (page === 1) stats.set(language, data.total_count)
    for (const repo of data.items) {
      pageTotal += 1
      if (isCandidate(repo)) {
        seen.set(repo.full_name, repo)
      }
    }
    if (data.items.length < PER_PAGE) break
    if (page < PAGES) await sleep(REQUEST_DELAY_MS)
  }
  console.log(`${language}: ${pageTotal} fetched, ${stats.get(language)} total matches`)
  await sleep(REQUEST_DELAY_MS)
}

const results = [...seen.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, MAX_RESULTS)

const lines = [
  `OpenFork Discoveries — ${today}`,
  `共 ${results.length} 个仓库（每日上限 ${MAX_RESULTS}）`,
  '条件: 主流语言 · Star 1-20 · 90 天内更新 · 含 README 与许可证 · 非 fork · 非空仓库',
  '',
  ...results.map(
    (r, i) =>
      `${i + 1}. https://github.com/${r.full_name} | ${r.description ?? ''} | ${r.language ?? ''} | ${r.stargazers_count} stars | ${r.license?.spdx_id ?? ''}`,
  ),
  '',
]

fs.mkdirSync('discoveries', { recursive: true })
fs.writeFileSync(filename, lines.join('\n'))

console.log(`\n${results.length} repositories after filtering, written to ${filename}`)
const summary = `## Discoveries\n\n${results.length} repositories found (${LANGUAGES.length} languages x ${PAGES} pages, 1-20 stars, updated within ${RECENT_DAYS} days, README + license required).\n\nWritten to ${filename}.\n`
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
}
