import { useState } from 'react'
import { CURRENCIES, formatAmount, symbolOf, todayStr } from '../utils.js'
import { dueDateIn, nextDueAfter } from '../recurring.js'

// 和面板里同一种写法：「9月28日」，不是「09-28」
function dueLabel(due) {
  if (!due) return ''
  const [, m, d] = due.split('-')
  return `${Number(m)}月${Number(d)}日`
}

/**
 * 固定支出设置页。
 *
 * 编辑用的是「整表提交」而不是逐字符落库——BudgetSettings 那次踩的坑
 * （每敲一个字就写库 → 重渲染 → 输入框换成新 DOM → 键盘消失）
 * 在这里靠一个持有自己 state 的独立编辑器组件绕开：
 * 打字的时候谁都不知道，按保存才碰数据库。
 */

// 用户已经说过自己有哪三笔。预填名称、分类和常见的扣款日，
// 只剩金额要填——少填三个字段，就少三次放弃的机会。
const PRESETS = [
  { name: '房租', categoryId: 'exp-housing', day: 1 },
  { name: '电话费', categoryId: 'exp-comm', day: 5 },
  { name: 'Amano 停车', categoryId: 'exp-transport', day: 1 },
]

export default function RecurringSettings({
  recurrings = [],
  categories = [],
  accounts = [],
  currency,
  onSave,
  onDelete,
  onBack,
}) {
  const [editing, setEditing] = useState(null)

  if (editing) {
    return (
      <RecurringEditor
        // key 让「换一条编辑」时整个编辑器重建，草稿不会串台
        key={editing.id ?? '__new__'}
        initial={editing}
        categories={categories}
        accounts={accounts}
        currency={currency}
        onSubmit={async (rec) => {
          await onSave(rec)
          setEditing(null)
        }}
        onDelete={
          editing.id
            ? async () => {
                await onDelete(editing.id)
                setEditing(null)
              }
            : null
        }
        onCancel={() => setEditing(null)}
      />
    )
  }

  const byCat = new Map(categories.map((c) => [c.id, c]))
  const today = todayStr()
  const used = new Set(recurrings.map((r) => r.name))

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>每月固定要扣的</h2>
          <span className="hint">{recurrings.length} 项</span>
        </div>

        {recurrings.length > 0 ? (
          <div className="card">
            {recurrings.map((r) => {
              const cat = byCat.get(r.categoryId)
              const next = nextDueAfter(r, today)
              return (
                <button key={r.id} className="list-item" onClick={() => setEditing(r)}>
                  <span className="li-main">
                    <span className="li-title">
                      <span className="e">{cat?.icon ?? '📌'}</span>
                      {r.name || '未命名'}
                      {r.active === false && <span className="rec-off">已停用</span>}
                    </span>
                    <span className="li-sub">
                      {r.cycle === 'yearly' ? `每年 ${r.month} 月 ${r.day} 号` : `每月 ${r.day} 号`}
                      {r.active !== false && next ? ` · 下次 ${dueLabel(next)}` : ''}
                    </span>
                  </span>
                  <span className="li-right rec-amt">
                    {symbolOf(r.currency || currency)} {formatAmount(r.amount)}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="card card-pad empty">
            <div className="big">📌</div>
            <p>还没登记固定支出</p>
            <p>登记之后，预算才知道月底还有多少钱是跑不掉的</p>
          </div>
        )}
      </div>

      {recurrings.length === 0 && (
        <div className="section">
          <div className="section-head">
            <h2>快速添加</h2>
          </div>
          <div className="card">
            {PRESETS.filter((p) => !used.has(p.name)).map((p) => (
              <button
                key={p.name}
                className="list-item"
                onClick={() => setEditing({ ...p, cycle: 'monthly', currency })}
              >
                <span className="li-main">
                  <span className="li-title">
                    <span className="e">{byCat.get(p.categoryId)?.icon ?? '📌'}</span>
                    {p.name}
                  </span>
                  <span className="li-sub">只需要填金额和扣款日</span>
                </span>
                <span className="li-right">＋</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="card">
          <button
            className="list-item"
            onClick={() => setEditing({ cycle: 'monthly', day: 1, currency })}
          >
            <span className="li-main">
              <span className="li-title">＋ 添加固定支出</span>
            </span>
            <span className="li-right">›</span>
          </button>
          <button className="list-item" onClick={onBack}>
            <span className="li-main">
              <span className="li-title">返回设置</span>
            </span>
            <span className="li-right">›</span>
          </button>
        </div>
      </div>

      <p className="note-box">
        登记在这里的支出<strong>不会自动记账</strong>——到了日子，首页会提醒你，点一下才写进流水。
        自动写的话，某个月忘了交、或者金额变了，账本就开始说谎，而账本一旦说过一次谎就没人再信它。
      </p>
    </div>
  )
}

/**
 * 编辑器。所有输入都在自己的 state 里，按「保存」才提交——
 * 打字过程中不触发任何上层重渲染，焦点自然留得住。
 */
function RecurringEditor({ initial, categories, accounts, currency, onSubmit, onDelete, onCancel }) {
  const [name, setName] = useState(initial.name ?? '')
  const [amount, setAmount] = useState(
    Number(initial.amount) > 0 ? String(initial.amount) : ''
  )
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? 'exp-other')
  const [accountId, setAccountId] = useState(initial.accountId ?? '')
  const [cur, setCur] = useState(initial.currency ?? currency)
  const [cycle, setCycle] = useState(initial.cycle ?? 'monthly')
  const [day, setDay] = useState(String(initial.day ?? 1))
  const [yearMonth, setYearMonth] = useState(String(initial.month ?? 1))
  const [active, setActive] = useState(initial.active !== false)

  const expenseCats = categories.filter((c) => c.type === 'expense')
  const amountNum = Number(amount)
  const valid = name.trim() && Number.isFinite(amountNum) && amountNum > 0

  // 预览下一次扣款，顺便让「31 号」的夹紧行为当场可见：
  // 设成 31 号，2 月那一行会自己显示 28 号，不用等到出错才发现。
  const preview = {
    name,
    amount: amountNum,
    cycle,
    day: Number(day) || 1,
    month: Number(yearMonth) || 1,
  }
  const next = valid ? nextDueAfter(preview, todayStr()) : null
  const feb = cycle === 'monthly' && Number(day) > 28 ? dueDateIn(preview, '2027-02') : null

  function handleAmount(text) {
    const v = text.replace(/[^0-9.]/g, '')
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(v)) return
    setAmount(v)
  }

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <h2>{initial.id ? '编辑固定支出' : '新的固定支出'}</h2>
        </div>
        <div className="card card-pad rec-form">
          <label className="field">
            <span className="field-label">名称</span>
            <input
              className="input"
              type="text"
              value={name}
              placeholder="例如：房租"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">每次金额</span>
            <span className="rec-amount-row">
              <span className="sym">{symbolOf(cur)}</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                onChange={(e) => handleAmount(e.target.value)}
              />
              <select className="input rec-cur" value={cur} onChange={(e) => setCur(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <div className="field">
            <span className="field-label">分类</span>
            <div className="cat-grid">
              {expenseCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="cat-chip"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                >
                  <span className="e">{c.icon}</span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">周期</span>
            <div className="seg">
              <button
                type="button"
                aria-pressed={cycle === 'monthly'}
                onClick={() => setCycle('monthly')}
              >
                每月
              </button>
              <button
                type="button"
                aria-pressed={cycle === 'yearly'}
                onClick={() => setCycle('yearly')}
              >
                每年
              </button>
            </div>
          </div>

          <label className="field">
            <span className="field-label">扣款日</span>
            <span className="rec-day-row">
              {cycle === 'yearly' && (
                <select
                  className="input"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m} 月
                    </option>
                  ))}
                </select>
              )}
              <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d} 号
                  </option>
                ))}
              </select>
            </span>
          </label>

          {accounts.length > 1 && (
            <label className="field">
              <span className="field-label">默认扣款账户</span>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">记账时再选</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field rec-toggle">
            <span className="li-main">
              <span className="li-title">启用</span>
              <span className="li-sub">停用后不再提醒，历史记录不受影响</span>
            </span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </label>

          {next && (
            <p className="rec-preview">
              下一次：<strong>{next}</strong>
              {feb && feb.slice(-2) !== String(day).padStart(2, '0') && (
                <>
                  <br />
                  {`遇到短月自动往前靠，例如 2027 年 2 月是 ${feb}。`}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <button
            className="list-item"
            disabled={!valid}
            onClick={() =>
              onSubmit({
                ...initial,
                name: name.trim(),
                amount: amountNum,
                currency: cur,
                categoryId,
                accountId: accountId || null,
                cycle,
                day: Number(day) || 1,
                month: cycle === 'yearly' ? Number(yearMonth) || 1 : null,
                active,
              })
            }
          >
            <span className="li-main">
              <span className="li-title">{initial.id ? '保存' : '添加'}</span>
              {!valid && <span className="li-sub">名称和金额都要填</span>}
            </span>
            <span className="li-right">✓</span>
          </button>
          <button className="list-item" onClick={onCancel}>
            <span className="li-main">
              <span className="li-title">取消</span>
            </span>
          </button>
        </div>
      </div>

      {onDelete && (
        <div className="section">
          <div className="card">
            <button
              className="list-item"
              onClick={() => {
                if (window.confirm('删掉这条固定支出？已经记过的流水不会被删。')) onDelete()
              }}
            >
              <span className="li-main">
                <span className="li-title" style={{ color: 'var(--danger)' }}>
                  删除
                </span>
                <span className="li-sub">只是不再提醒，历史记录保留</span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
