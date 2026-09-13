import { useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import { ACCOUNT_ICON_CHOICES, SERIES_SLOTS } from '../categories.js'
import { newId } from '../db.js'
import { currentMonth, formatAmount, formatMoney, symbolOf } from '../utils.js'

/**
 * 账户余额 = 期初余额 + 所有收入 − 所有支出。
 * 用全部流水算，不受顶部月份切换影响——余额是个时点值，不是区间值。
 */
function computeBalances(accounts, records) {
  const map = new Map(accounts.map((a) => [a.id, { ...a, balance: a.initialBalance ?? 0, monthExpense: 0, count: 0 }]))
  const thisMonth = currentMonth()
  for (const t of records) {
    const row = map.get(t.accountId)
    if (!row) continue
    const amt = Number(t.amount)
    row.balance += t.type === 'income' ? amt : -amt
    row.count++
    if (t.month === thisMonth && t.type === 'expense') row.monthExpense += amt
  }
  return [...map.values()]
}

export default function AccountsPage({ accounts, records, currency, onSave, onDelete }) {
  const [editing, setEditing] = useState(null)

  const rows = useMemo(() => computeBalances(accounts, records), [accounts, records])
  const total = rows.reduce((a, r) => a + r.balance, 0)
  // 归属到已删除账户的流水，避免它们在总资产里凭空消失
  const orphan = records.filter((t) => !accounts.some((a) => a.id === t.accountId)).length

  function startNew() {
    const used = new Set(accounts.map((a) => a.slot))
    setEditing({
      id: newId(),
      name: '',
      icon: '💳',
      slot: SERIES_SLOTS.find((s) => !used.has(s)) ?? 1,
      initialBalance: 0,
      order: Math.max(0, ...accounts.map((a) => a.order)) + 1,
      isNew: true,
    })
  }

  return (
    <div>
      <section className="summary">
        <div className="label">总资产</div>
        <div className="hero">
          <span className="sym">{symbolOf(currency)}</span>
          {total < 0 && '-'}
          {formatAmount(total)}
        </div>
        <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat">
            <div className="k">账户数</div>
            <div className="v">{accounts.length}</div>
          </div>
          <div className="stat">
            <div className="k">总笔数</div>
            <div className="v">{records.length}</div>
          </div>
        </div>
      </section>

      <div className="section">
        <div className="section-head">
          <h2>我的账户</h2>
          <span className="hint">点账户可编辑</span>
        </div>

        <div className="card">
          {rows.map((a) => (
            <button className="acct-row" key={a.id} onClick={() => setEditing({ ...a })}>
              <span className="emoji" style={{ borderColor: `var(--series-${a.slot})` }}>
                {a.icon}
              </span>
              <span className="body">
                <span className="name">{a.name}</span>
                <span className="sub">
                  {a.count} 笔
                  {a.monthExpense > 0 && ` · 本月支出 ${formatAmount(a.monthExpense)}`}
                </span>
              </span>
              <span className={`bal ${a.balance < 0 ? 'neg' : ''}`}>
                {a.balance < 0 && '-'}
                {formatAmount(a.balance)}
              </span>
            </button>
          ))}
        </div>

        <button className="btn secondary slim" onClick={startNew}>
          ＋ 新增账户
        </button>

        {orphan > 0 && (
          <p className="note-box" style={{ marginTop: 12 }}>
            有 {orphan} 笔记录归属的账户已被删除，它们仍在流水里，但不计入任何账户余额。
            新建一个账户后编辑这些记录即可重新归位。
          </p>
        )}
      </div>

      {editing && (
        <AccountSheet
          account={editing}
          currency={currency}
          canDelete={accounts.length > 1}
          onSave={(a) => {
            const { isNew, balance, monthExpense, count, ...rest } = a
            onSave(rest)
            setEditing(null)
          }}
          onDelete={() => {
            onDelete(editing.id)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function AccountSheet({ account, currency, canDelete, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(account)

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-head">
        <h3>{account.isNew ? '新增账户' : '编辑账户'}</h3>
        {!account.isNew && canDelete && (
          <button
            className="link"
            onClick={() => {
              if (window.confirm(`删除「${account.name}」？该账户下的记录会保留，但不再计入任何余额。`))
                onDelete()
            }}
          >
            删除
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="acc-name">账户名称</label>
        <input
          id="acc-name"
          className="input"
          maxLength={12}
          placeholder="例如：TnG 电子钱包"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="acc-init">期初余额</label>
        <div className="amount-field" style={{ padding: '10px 14px' }}>
          <span className="sym">{symbolOf(currency)}</span>
          <input
            id="acc-init"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            style={{ fontSize: 22 }}
            value={String(draft.initialBalance ?? '')}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.-]/g, '')
              if (/^-?\d*\.?\d{0,2}$/.test(v)) setDraft({ ...draft, initialBalance: v })
            }}
          />
        </div>
        <p className="cal-hint" style={{ textAlign: 'left', marginTop: 6 }}>
          开始记账前这个账户里已有的钱。之后的余额 = 期初余额 + 收入 − 支出。
        </p>
      </div>

      <div className="field">
        <span className="field-label">图标</span>
        <div className="cat-grid">
          {ACCOUNT_ICON_CHOICES.map((ic) => (
            <button
              key={ic}
              className="cat-chip"
              aria-pressed={draft.icon === ic}
              onClick={() => setDraft({ ...draft, icon: ic })}
              style={{ padding: '9px 0 7px' }}
            >
              <span className="e">{ic}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">标识色</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[0, ...SERIES_SLOTS].map((s) => (
            <button
              key={s}
              aria-label={`颜色 ${s}`}
              aria-pressed={draft.slot === s}
              onClick={() => setDraft({ ...draft, slot: s })}
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: `var(--series-${s})`,
                outline: draft.slot === s ? '2px solid var(--text-primary)' : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </div>

      <button
        className="btn"
        disabled={!String(draft.name).trim()}
        onClick={() =>
          onSave({
            ...draft,
            name: String(draft.name).trim(),
            initialBalance: Number(draft.initialBalance) || 0,
          })
        }
      >
        保存
      </button>
    </Sheet>
  )
}
