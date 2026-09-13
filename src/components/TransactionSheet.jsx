import { useEffect, useMemo, useState } from 'react'
import { symbolOf, todayStr } from '../utils.js'
import Sheet from './Sheet.jsx'

export default function TransactionSheet({
  categories,
  currency,
  initial,
  onSave,
  onDelete,
  onClose,
}) {
  const editing = Boolean(initial?.id)
  const [type, setType] = useState(initial?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [date, setDate] = useState(initial?.date ?? todayStr())
  const [note, setNote] = useState(initial?.note ?? '')

  const options = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  )

  useEffect(() => {
    if (!options.some((c) => c.id === categoryId)) {
      setCategoryId(options[0]?.id ?? '')
    }
  }, [options, categoryId])

  const value = Number(amount)
  const valid = amount !== '' && !Number.isNaN(value) && value > 0 && categoryId

  function submit(e) {
    e.preventDefault()
    if (!valid) return
    onSave({
      ...(initial ?? {}),
      type,
      amount: value,
      categoryId,
      date,
      note: note.trim(),
    })
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-head">
        <h3>{editing ? '编辑记录' : '记一笔'}</h3>
        {editing && (
          <button type="button" className="link" onClick={() => onDelete(initial.id)}>
            删除
          </button>
        )}
      </div>

      <form onSubmit={submit}>
        <div className="seg" role="group" aria-label="收支类型">
          <button type="button" aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
            支出
          </button>
          <button type="button" aria-pressed={type === 'income'} onClick={() => setType('income')}>
            收入
          </button>
        </div>

        <div className="amount-field">
          <span className="sym">{symbolOf(currency)}</span>
          <label className="sr-only" htmlFor="amt">
            金额
          </label>
          <input
            id="amt"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v)
            }}
            autoFocus={!editing}
          />
        </div>

        <div className="field">
          <span className="field-label">分类</span>
          <div className="cat-grid">
            {options.map((c) => (
              <button
                type="button"
                key={c.id}
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
          <label htmlFor="date">日期</label>
          <input
            id="date"
            className="input"
            type="date"
            value={date}
            max="2099-12-31"
            onChange={(e) => setDate(e.target.value || todayStr())}
          />
        </div>

        <div className="field">
          <label htmlFor="note">备注（可选）</label>
          <input
            id="note"
            className="input"
            type="text"
            maxLength={60}
            placeholder="例如：和同事午饭"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <button className="btn" type="submit" disabled={!valid}>
          {editing ? '保存修改' : '保存'}
        </button>
      </form>
    </Sheet>
  )
}
