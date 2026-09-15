import { useState } from 'react'
import { TOTAL_ID } from '../budget.js'
import { formatAmount, symbolOf } from '../utils.js'

/**
 * 预算设置页。总额一个，支出分类各一个，留空 = 不限。
 *
 * 输入框和汇率那里踩过的是同一个坑：显示值不能从已存的数字反推，
 * 否则「0」「0.」这些输入中途的文本会被当成清空，你永远打不出 0.5。
 * 所以编辑中的原始文本单独存一份草稿。
 */
export default function BudgetSettings({ budgets, categories, currency, onSave, onBack }) {
  const [drafts, setDrafts] = useState({})
  const sym = symbolOf(currency)

  const byId = new Map(budgets.map((b) => [b.id, b]))
  const expenseCats = categories.filter((c) => c.type === 'expense')

  const saved = (id) => {
    const n = Number(byId.get(id)?.amount)
    return Number.isFinite(n) && n > 0 ? String(n) : ''
  }

  function edit(id, text) {
    const v = text.replace(/[^0-9.]/g, '')
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(v)) return
    setDrafts((d) => ({ ...d, [id]: v }))
    onSave(id, v === '' ? 0 : Number(v))
  }

  function settle(id) {
    setDrafts((d) => {
      const { [id]: _drop, ...rest } = d
      return rest
    })
  }

  // 分类预算加起来和总额的关系——超了就提醒一句，但不阻止：
  // 你可能故意让分类之和小于总额，留一块机动。
  const catSum = expenseCats.reduce((a, c) => a + (Number(byId.get(c.id)?.amount) || 0), 0)
  const totalLimit = Number(byId.get(TOTAL_ID)?.amount) || 0
  const overAllocated = totalLimit > 0 && catSum > totalLimit

  const Row = ({ id, title, sub, icon }) => (
    <div className="list-item bud-item">
      <span className="li-main">
        <span className="li-title">
          {icon ? <span className="e">{icon}</span> : null}
          {title}
        </span>
        {sub ? <span className="li-sub">{sub}</span> : null}
      </span>
      <span className="bud-input-wrap">
        <span className="sym">{sym}</span>
        <input
          className="input bud-input"
          type="text"
          inputMode="decimal"
          placeholder="不限"
          aria-label={`${title}预算`}
          value={drafts[id] ?? saved(id)}
          onChange={(e) => edit(id, e.target.value)}
          onBlur={() => settle(id)}
        />
      </span>
    </div>
  )

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>每月总额</h2>
        </div>
        <div className="card">
          <Row id={TOTAL_ID} title="本月可花" sub="所有支出加起来的上限" />
        </div>
        <p className="note-box" style={{ marginTop: 12 }}>
          预算按自然月算，每月 1 号自动重来。只管支出——这个月多赚了钱不会让上限变高。
          留空就是不限。
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>分类上限</h2>
          <span className="hint">留空 = 不限</span>
        </div>
        <div className="card">
          {expenseCats.map((c) => (
            <Row key={c.id} id={c.id} title={c.name} icon={c.icon} />
          ))}
        </div>
        {overAllocated && (
          <p className="note-box warn" style={{ marginTop: 12 }}>
            {`分类上限加起来是 ${sym} ${formatAmount(catSum)}，超过了总额 ${sym} ${formatAmount(totalLimit)}。
            这不影响使用，两边各算各的——但真按分类花满，总额一定会爆。`}
          </p>
        )}
      </div>

      <div className="section">
        <div className="card">
          <button className="list-item" onClick={onBack}>
            <span className="li-main">
              <span className="li-title">返回设置</span>
            </span>
            <span className="li-right">›</span>
          </button>
        </div>
      </div>
    </div>
  )
}
