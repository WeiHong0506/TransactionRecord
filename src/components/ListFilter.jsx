import { formatAmount, sumBy } from '../utils.js'

export const EMPTY_FILTER = { q: '', type: 'all', categoryId: 'all', accountId: 'all' }

export function isFiltered(f) {
  return f.q.trim() !== '' || f.type !== 'all' || f.categoryId !== 'all' || f.accountId !== 'all'
}

export function applyFilter(records, f) {
  const q = f.q.trim().toLowerCase()
  return records.filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false
    if (f.categoryId !== 'all' && t.categoryId !== f.categoryId) return false
    if (f.accountId !== 'all' && t.accountId !== f.accountId) return false
    if (q && !String(t.note ?? '').toLowerCase().includes(q)) return false
    return true
  })
}

export default function ListFilter({ filter, setFilter, categories, accounts, results }) {
  const active = isFiltered(filter)
  // 分类下拉只列出与当前收支类型相符的，避免选了「支出 + 工资」这种必然为空的组合
  const cats = categories.filter((c) => filter.type === 'all' || c.type === filter.type)

  const set = (patch) => setFilter({ ...filter, ...patch })

  return (
    <div className="filter">
      <div className="filter-search">
        <span className="ico" aria-hidden>
          🔍
        </span>
        <input
          type="search"
          placeholder="搜索备注"
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="搜索备注"
        />
        {active && (
          <button className="clear" onClick={() => setFilter(EMPTY_FILTER)}>
            清除
          </button>
        )}
      </div>

      <div className="filter-row">
        <select
          className="input"
          value={filter.type}
          // 切换收支类型时，原来选的分类多半不再适用，一并重置
          onChange={(e) => set({ type: e.target.value, categoryId: 'all' })}
          aria-label="收支类型"
        >
          <option value="all">全部收支</option>
          <option value="expense">仅支出</option>
          <option value="income">仅收入</option>
        </select>

        <select
          className="input"
          value={filter.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
          aria-label="分类"
        >
          <option value="all">全部分类</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>

        {accounts.length > 1 && (
          <select
            className="input"
            value={filter.accountId}
            onChange={(e) => set({ accountId: e.target.value })}
            aria-label="账户"
          >
            <option value="all">全部账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {active && (
        <div className="filter-summary">
          筛选出 {results.length} 笔
          {sumBy(results, 'expense') > 0 && ` · 支出 ${formatAmount(sumBy(results, 'expense'))}`}
          {sumBy(results, 'income') > 0 && ` · 收入 ${formatAmount(sumBy(results, 'income'))}`}
        </div>
      )}
    </div>
  )
}
