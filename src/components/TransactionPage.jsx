import { useEffect, useMemo, useRef, useState } from 'react'
import { formatAmount, symbolOf, todayStr } from '../utils.js'
import AmountPad from './AmountPad.jsx'

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
  taxRates,
  onTaxRatesChange,
  onSave,
  onDelete,
  onClose,
}) {
  const editing = Boolean(initial?.id)
  const [type, setType] = useState(initial?.type ?? 'expense')
  const [amount, setAmount] = useState(initial ? Number(initial.amount) : null)
  const [taxMarks, setTaxMarks] = useState([])
  // 新记一笔时直接把键盘唤起来——你点加号进来就是为了输金额；
  // 编辑已有记录时不弹，免得挡住要改的其他字段
  const [padOpen, setPadOpen] = useState(!initial?.id)
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
    /**
     * iOS Safari 上光靠 body{overflow:hidden} 锁不住背景——手指落在输入框上、
     * 或者键盘弹起来把视口压矮之后，底下那一页照样能滑。唯一可靠的办法是
     * 把 body 整个 position:fixed 钉住，并记下当前滚动位置，关闭时再滚回去。
     */
    const scrollY = window.scrollY
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }
    Object.assign(document.body.style, {
      position: 'fixed',
      top: `-${scrollY}px`,
      left: '0',
      right: '0',
      width: '100%',
      overflow: 'hidden',
    })

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
      Object.assign(document.body.style, prev)
      // 解锁后浏览器会把页面弹回顶部，手动滚回原位，否则关掉表单就找不到刚才看到哪了
      window.scrollTo(0, scrollY)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      // 保存成功之类的原因直接卸载时，把刚才压进去的那条历史记录清掉，
      // 否则用户下次按返回会白按一次
      if (!popped) window.history.back()
    }
  }, [])

  // 金额的计价单位跟着所选账户走，不是主货币——在中国用支付宝付的 45 块是
  // ¥45，不是 RM45。折算留到统计时再做。
  const account = accounts.find((a) => a.id === accountId)
  const payCurrency = account?.currency || currency

  const options = useMemo(() => categories.filter((c) => c.type === type), [categories, type])

  useEffect(() => {
    if (!options.some((c) => c.id === categoryId)) {
      setCategoryId(options[0]?.id ?? '')
    }
  }, [options, categoryId])

  const valid = amount !== null && Number.isFinite(amount) && amount > 0 && categoryId && accountId

  function submit(e) {
    e.preventDefault()
    if (!valid) return
    onSave({
      ...(initial ?? {}),
      type,
      amount,
      categoryId,
      accountId,
      currency: payCurrency,
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

          <button
            type="button"
            id="amt"
            className="amount-field"
            data-active={padOpen ? 'true' : 'false'}
            onClick={() => setPadOpen((v) => !v)}
            aria-label={`金额 ${amount === null ? '未填' : formatAmount(amount)}，点击输入`}
          >
            <span className="sym">{symbolOf(payCurrency)}</span>
            <span className="amt-val" data-empty={amount === null ? 'true' : 'false'} aria-live="polite">
              {amount === null ? '0.00' : formatAmount(amount)}
            </span>
            {/* 保存之前这个标记一直挂着，解释金额为什么不等于你打进去的那个数。
                落账只存最终金额，所以它不会出现在已保存的记录上。 */}
            {taxMarks.length > 0 && <span className="tax-mark">含 {taxMarks.join(' · ')}</span>}
          </button>

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
                    {(a.currency || currency) !== currency && (
                      <span className="cur-tag">{a.currency}</span>
                    )}
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

        <AmountPad
          open={padOpen}
          currency={payCurrency}
          initialAmount={initial?.amount}
          rates={taxRates}
          onRatesChange={onTaxRatesChange}
          onValue={(total, marks) => {
            setAmount(total)
            setTaxMarks(marks)
          }}
          onClose={() => setPadOpen(false)}
        />
      </form>
    </div>
  )
}
