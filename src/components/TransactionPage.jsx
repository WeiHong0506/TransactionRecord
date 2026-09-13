import { useEffect, useMemo, useRef, useState } from 'react'
import { symbolOf, todayStr } from '../utils.js'

/**
 * 记一笔 / 编辑记录——整页表单，不是弹层。
 *
 * 表单本身当作 flex 容器：标题栏和底部保存键固定，中间字段区滚动。
 * 这样在小屏上弹出键盘时保存键不会被顶走，也不会像半屏弹层那样
 * 一边滚表单一边滚背景。
 */
export default function TransactionPage({
  categories,
  accounts,
  currency,
  initial,
  defaultAccountId,
  onSave,
  onDelete,
  onClose,
}) {
  const editing = Boolean(initial?.id)
  const [type, setType] = useState(initial?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [accountId, setAccountId] = useState(
    initial?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? ''
  )
  const [date, setDate] = useState(initial?.date ?? todayStr())
  const [note, setNote] = useState(initial?.note ?? '')

  // 关闭回调放进 ref，免得 effect 因为父组件重渲染而重跑（会多压一条历史记录）
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // 压一条历史记录：安卓返回键和 iOS 侧滑就是「关掉这一页」，而不是退出整个应用
    let popped = false
    window.history.pushState({ sheet: 'transaction' }, '')
    const onPop = () => {
      popped = true
      closeRef.current()
    }
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      // 保存成功之类的原因直接卸载时，把刚才压进去的那条历史记录清掉，
      // 否则用户下次按返回会白按一次
      if (!popped) window.history.back()
    }
  }, [])

  const options = useMemo(() => categories.filter((c) => c.type === type), [categories, type])

  useEffect(() => {
    if (!options.some((c) => c.id === categoryId)) {
      setCategoryId(options[0]?.id ?? '')
    }
  }, [options, categoryId])

  const value = Number(amount)
  const valid = amount !== '' && !Number.isNaN(value) && value > 0 && categoryId && accountId

  function submit(e) {
    e.preventDefault()
    if (!valid) return
    onSave({
      ...(initial ?? {}),
      type,
      amount: value,
      categoryId,
      accountId,
      date,
      note: note.trim(),
    })
  }

  return (
    <div className="page-layer" role="dialog" aria-modal="true" aria-label={editing ? '编辑记录' : '记一笔'}>
      <form className="page-form" onSubmit={submit}>
        <header className="page-bar">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ‹
          </button>
          <h1 className="page-title">{editing ? '编辑记录' : '记一笔'}</h1>
          {editing ? (
            <button type="button" className="link" onClick={() => onDelete(initial.id)}>
              删除
            </button>
          ) : (
            <span className="bar-pad" />
          )}
        </header>

        <div className="page-body">
          <div className="seg" role="group" aria-label="收支类型">
            <button
              type="button"
              aria-pressed={type === 'expense'}
              onClick={() => setType('expense')}
            >
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

          {accounts.length > 1 && (
            <div className="field">
              <span className="field-label">账户</span>
              <div className="acct-picker">
                {accounts.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className="acct-chip"
                    aria-pressed={accountId === a.id}
                    onClick={() => setAccountId(a.id)}
                  >
                    <span className="e">{a.icon}</span>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="date">日期</label>
            <input
              id="date"
              className="input date-input"
              type="date"
              value={date}
              max="2099-12-31"
              onChange={(e) => setDate(e.target.value || todayStr())}
            />
            <div className="quick-dates">
              <button type="button" onClick={() => setDate(todayStr())} aria-pressed={date === todayStr()}>
                今天
              </button>
              <button
                type="button"
                onClick={() => setDate(todayStr(-1))}
                aria-pressed={date === todayStr(-1)}
              >
                昨天
              </button>
            </div>
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
        </div>

        <div className="page-foot">
          <button className="btn" type="submit" disabled={!valid}>
            {editing ? '保存修改' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
