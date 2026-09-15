import { useEffect, useRef, useState } from 'react'
import { TOTAL_ID } from '../budget.js'
import { formatAmount, symbolOf } from '../utils.js'

/**
 * 预算设置页。总额一个，支出分类各一个，留空 = 不限。
 *
 * 这个文件里有两个曾经踩过的坑，都会导致「输入一个数字键盘就消失」：
 *
 * 1. 行组件必须定义在模块顶层，不能写在 BudgetSettings 函数体里。
 *    写在里面的话每次渲染都是一个新函数，React 认为组件类型变了，
 *    会卸载重建整棵子树——输入框换成新 DOM，焦点必然丢失。
 *
 * 2. 不要每敲一个字符就写库。写库会触发 reload 和整页重渲染，
 *    既浪费又给上面那个问题递刀子。改成失焦时才落库，
 *    另外在卸载时兜一次底，防止用手势返回时没触发 blur。
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

  // 还没落库的草稿。用 ref 是为了让卸载时的清理函数拿到最新值，
  // 而不是闭包里那份过期的 state。
  const pending = useRef({})
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    return () => {
      // 手势返回、切 tab 之类的路径不一定触发 blur，这里兜底
      for (const [id, v] of Object.entries(pending.current)) {
        saveRef.current(id, v === '' ? 0 : Number(v))
      }
      pending.current = {}
    }
  }, [])

  function edit(id, text) {
    const v = text.replace(/[^0-9.]/g, '')
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(v)) return
    // 只动本地草稿——不写库，所以不会重渲染整页，焦点稳如泰山
    setDrafts((d) => ({ ...d, [id]: v }))
    pending.current[id] = v
  }

  function settle(id) {
    const v = pending.current[id]
    if (v !== undefined) {
      onSave(id, v === '' ? 0 : Number(v))
      delete pending.current[id]
    }
    setDrafts((d) => {
      const { [id]: _drop, ...rest } = d
      return rest
    })
  }

  // 分类之和与总额的关系。超了只提醒不拦截——你可能故意让分类之和
  // 小于总额，留一块机动；也可能反过来，知道自己不会每项都花满。
  const catSum = expenseCats.reduce((a, c) => a + (Number(byId.get(c.id)?.amount) || 0), 0)
  const totalLimit = Number(byId.get(TOTAL_ID)?.amount) || 0
  const overAllocated = totalLimit > 0 && catSum > totalLimit

  const rowProps = { sym, drafts, saved, onEdit: edit, onSettle: settle }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>每月总额</h2>
        </div>
        <div className="card">
          <BudgetRow id={TOTAL_ID} title="本月可花" sub="所有支出加起来的上限" {...rowProps} />
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
            <BudgetRow key={c.id} id={c.id} title={c.name} icon={c.icon} {...rowProps} />
          ))}
        </div>
        {overAllocated && (
          <p className="note-box warn" style={{ marginTop: 12 }}>
            {`分类上限加起来是 ${sym} ${formatAmount(catSum)}，超过了总额 ${sym} ${formatAmount(totalLimit)}。这不影响使用，两边各算各的——但真按分类花满，总额一定会爆。`}
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

/**
 * 定义在模块顶层，不在 BudgetSettings 里面——这是焦点能留住的前提。
 */
function BudgetRow({ id, title, sub, icon, sym, drafts, saved, onEdit, onSettle }) {
  return (
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
          onChange={(e) => onEdit(id, e.target.value)}
          onBlur={() => onSettle(id)}
        />
      </span>
    </div>
  )
}
