import { useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import { ACCOUNT_ICON_CHOICES, SERIES_SLOTS } from '../categories.js'
import { newId } from '../db.js'
import { CURRENCIES, currentMonth, formatAmount, formatMoney, rateOf, symbolOf } from '../utils.js'

/**
 * 账户余额 = 期初余额 + 所有收入 − 所有支出，全部用账户自己的货币算。
 * 用全部流水算，不受顶部月份切换影响——余额是个时点值，不是区间值。
 *
 * 关键在于余额绝不折算：人民币账户的余额永远是人民币，和支付宝里显示的
 * 数字一分不差。折算只发生在最后汇总成总资产的那一步。
 */
function computeBalances(accounts, records, fx, home) {
  const map = new Map(
    accounts.map((a) => [
      a.id,
      { ...a, currency: a.currency || home, balance: Number(a.initialBalance ?? 0), monthExpense: 0, count: 0 },
    ])
  )
  const thisMonth = currentMonth()
  for (const t of records) {
    const row = map.get(t.accountId)
    if (!row) continue
    const amt = Number(t.amount)
    row.balance += t.type === 'income' ? amt : -amt
    row.count++
    if (t.month === thisMonth && t.type === 'expense') row.monthExpense += amt
  }
  for (const row of map.values()) {
    const r = rateOf(fx, row.currency, home)
    row.rate = r
    row.homeBalance = r === null ? null : row.balance * r
  }
  return [...map.values()]
}

export default function AccountsPage({
  accounts,
  records,
  currency,
  fx,
  missingRates = [],
  onOpenSettings,
  onSave,
  onDelete,
}) {
  const [editing, setEditing] = useState(null)

  const rows = useMemo(
    () => computeBalances(accounts, records, fx, currency),
    [accounts, records, fx, currency]
  )
  // 汇率缺失的账户算不进总资产——下面有提示，不会悄悄少算
  const total = rows.reduce((a, r) => a + (r.homeBalance ?? 0), 0)
  const hasForeign = rows.some((r) => r.currency !== currency)
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
        {hasForeign && (
          <p className="fx-note">
            {`外币账户按你设定的汇率折算成${symbolOf(currency)}，是估算值；各账户自己的余额不受影响。`}
          </p>
        )}
      </section>

      {missingRates.length > 0 && (
        <button className="note-box warn" onClick={onOpenSettings}>
          {`还没设置 ${missingRates.join('、')} 的汇率，这些账户暂时没算进总资产，相关记录也不计入统计。点这里去设置 ›`}
        </button>
      )}

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
                <span className="name">
                  {a.name}
                  {a.currency !== currency && <span className="cur-tag">{a.currency}</span>}
                </span>
                <span className="sub">
                  {a.count} 笔
                  {a.monthExpense > 0 &&
                    ` · 本月支出 ${symbolOf(a.currency)} ${formatAmount(a.monthExpense)}`}
                </span>
              </span>
              <span className="bal-col">
                <span className={`bal ${a.balance < 0 ? 'neg' : ''}`}>
                  {a.balance < 0 && '-'}
                  {symbolOf(a.currency)} {formatAmount(a.balance)}
                </span>
                {a.currency !== currency && (
                  <span className="bal-sub">
                    {a.homeBalance === null
                      ? '未设汇率'
                      : `≈ ${formatMoney(a.homeBalance, currency)}`}
                  </span>
                )}
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
          usedCount={rows.find((r) => r.id === editing.id)?.count ?? 0}
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

function AccountSheet({ account, currency, usedCount = 0, canDelete, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState({ ...account, currency: account.currency || currency })
  // 已经有流水的账户不让改货币：改了等于把历史金额的含义整体改掉
  // （RM 38.50 的午饭一键变成 ¥38.50），而且无法还原。
  const currencyLocked = !account.isNew && usedCount > 0
  const cur = draft.currency || currency

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
        <label htmlFor="acc-cur">货币</label>
        <select
          id="acc-cur"
          className="input"
          value={cur}
          disabled={currencyLocked}
          onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="cal-hint" style={{ textAlign: 'left', marginTop: 6 }}>
          {currencyLocked
            ? `已有 ${usedCount} 笔记录，货币不能再改——改了会把这些记录的金额含义整体改掉。需要换币请新建一个账户。`
            : cur === currency
              ? '这个账户里的钱是什么货币。和主货币一致，不需要折算。'
              : `这个账户的余额和记录都用${symbolOf(cur)}计价，汇总进总资产时才按汇率折成${symbolOf(currency)}。`}
        </p>
      </div>

      <div className="field">
        <label htmlFor="acc-init">期初余额</label>
        <div className="amount-field" style={{ padding: '10px 14px' }}>
          <span className="sym">{symbolOf(cur)}</span>
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
