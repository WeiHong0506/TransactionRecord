import { useEffect, useRef, useState } from 'react'
import { EMPTY_PAD, OPS, applyTax, formatExpr, padFromAmount, padReduce, padValue } from '../padMath.js'
import { formatAmount, symbolOf } from '../utils.js'

/**
 * 自建金额键盘。
 *
 * 为什么不用系统键盘：系统数字面板弹起来会压矮视口、逼页面重排，
 * 这正是「表单打开后还能滑到背景」那个 bug 的根源。自己画的键盘是页面的
 * 一部分，视口纹丝不动；顺带还能塞下四则运算和税费开关。
 *
 * 组件一直挂载，只靠 data-open 控制显隐。这一点很关键——算式和税费开关
 * 存在组件自己的 state 里，收起键盘不该把它们清掉，否则重新点开金额栏
 * 就退回小计，刚加的服务费和 SST 凭空消失。归零只发生在整个表单卸载重建时。
 */

// 按键表。label 是显示的字，aria 是读屏念的字（符号直接念出来没法听）
const KEYS = [
  { k: 'del', label: '⌫', aria: '退格', cls: 'op tiny' },
  { k: '÷', label: '÷', aria: '除以', cls: 'op' },
  { k: '×', label: '×', aria: '乘以', cls: 'op' },
  { k: '−', label: '−', aria: '减', cls: 'op' },
  { k: '7', label: '7' },
  { k: '8', label: '8' },
  { k: '9', label: '9' },
  { k: '+', label: '+', aria: '加', cls: 'op wide' },
  { k: '4', label: '4' },
  { k: '5', label: '5' },
  { k: '6', label: '6' },
  { k: '1', label: '1' },
  { k: '2', label: '2' },
  { k: '3', label: '3' },
  { k: 'done', label: '完成', cls: 'done' },
  { k: '00', label: '00', cls: 'tiny' },
  { k: '0', label: '0' },
  { k: '.', label: '.', aria: '小数点' },
]

export default function AmountPad({
  open,
  currency,
  initialAmount,
  rates,
  onRatesChange,
  onValue,
  onClose,
}) {
  const [pad, setPad] = useState(() => padFromAmount(initialAmount))
  const [scOn, setScOn] = useState(false)
  const [sstOn, setSstOn] = useState(false)
  // null = 正在输金额；'sc' / 'sst' = 正在改那一项的税率
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')

  const base = padValue(pad)
  const has = base !== null && Number.isFinite(base)
  const t = applyTax(has ? base : 0, { sc: scOn ? rates.sc : 0, sst: sstOn ? rates.sst : 0 })

  const marks = []
  if (scOn) marks.push(`服务费 ${rates.sc}%`)
  if (sstOn) marks.push(`SST ${rates.sst}%`)

  // 回调放进 ref，免得父组件每次重渲染都触发一轮 effect
  const valueRef = useRef(onValue)
  valueRef.current = onValue
  useEffect(() => {
    valueRef.current(has && t.total > 0 ? t.total : null, marks)
    // marks 是每次渲染新建的数组，放进依赖会死循环，用它的内容代替
  }, [has, t.total, marks.join('|')])

  function key(k) {
    if (editing) return editRate(k)
    if (k === 'done') return onClose()
    setPad((p) => padReduce(p, k))
  }

  // 税率复用同一套按键，不唤起系统键盘
  function editRate(k) {
    if (k === 'done') {
      const v = draft === '' ? 0 : Number(draft)
      const next = { ...rates, [editing]: Number.isFinite(v) ? v : 0 }
      onRatesChange(next)
      if (v > 0) (editing === 'sc' ? setScOn : setSstOn)(true)
      setEditing(null)
      return
    }
    if (k === 'del') return setDraft((d) => d.slice(0, -1))
    if (k === '.') return setDraft((d) => (d.includes('.') ? d : d === '' ? '0.' : d + '.'))
    if (!/^[0-9]+$/.test(k)) return
    setDraft((d) => {
      const next = d === '0' ? k : d + k
      // 税率封顶 100%，两位小数足够
      if (!/^\d{0,3}(\.\d{0,2})?$/.test(next) || Number(next) > 100) return d
      return next
    })
  }

  function startRate(which) {
    setEditing(which)
    setDraft(String(rates[which] ?? 0))
  }

  // 电脑上物理键盘照常能用
  useEffect(() => {
    if (!open) return
    const map = { '*': '×', x: '×', X: '×', '/': '÷', '-': '−', '+': '+' }
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9.]$/.test(e.key)) key(e.key)
      else if (map[e.key] && !editing) key(map[e.key])
      else if (e.key === 'Backspace') key('del')
      else if (e.key === 'Enter') key('done')
      else if (e.key === 'Escape') editing ? setEditing(null) : onClose()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // 捕获阶段拦下来，免得 Escape 顺带把整个记账页也关掉
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const sym = symbolOf(currency)

  return (
    <div className="pad-sheet" data-open={open ? 'true' : 'false'} aria-hidden={!open}>
      {editing ? (
        <div className="rate-edit">
          <span className="re-label">{editing === 'sc' ? '服务费' : 'SST'}税率</span>
          <span className="re-val">
            {draft === '' ? '0' : draft}
            <i>%</i>
          </span>
        </div>
      ) : (
        <div className="pad-expr">{formatExpr(pad)}</div>
      )}

      {!editing && (scOn || sstOn) && has && (
        <div className="receipt">
          <div className="r-line">
            <span>小计</span>
            <span className="lead" />
            <span className="num">{formatAmount(t.base)}</span>
          </div>
          {scOn && (
            <div className="r-line">
              <span>服务费 {rates.sc}%</span>
              <span className="lead" />
              <span className="num">{formatAmount(t.sc)}</span>
            </div>
          )}
          {sstOn && (
            <div className="r-line">
              <span>SST {rates.sst}%</span>
              <span className="lead" />
              <span className="num">{formatAmount(t.sst)}</span>
            </div>
          )}
          <div className="r-line total">
            <span>合计</span>
            <span className="lead" />
            <span className="num">
              {sym} {formatAmount(t.total)}
            </span>
          </div>
        </div>
      )}

      <div className="tax-row" data-dim={editing ? 'true' : 'false'}>
        <TaxCtl
          name="服务费"
          rate={rates.sc}
          on={scOn}
          onToggle={() => setScOn((v) => !v)}
          onEdit={() => startRate('sc')}
        />
        <TaxCtl
          name="SST"
          rate={rates.sst}
          on={sstOn}
          onToggle={() => setSstOn((v) => !v)}
          onEdit={() => startRate('sst')}
        />
      </div>

      <div className="pad-keys" role="group" aria-label="金额键盘">
        {KEYS.map((b) => {
          const isArith = OPS.includes(b.k)
          return (
            <button
              key={b.k}
              type="button"
              className={`pad-key ${b.cls ?? ''}`}
              // 税率用不上四则运算
              disabled={(editing && isArith) || (b.k === 'done' && !editing && !(has && t.total > 0))}
              data-armed={!editing && b.k === pad.op && pad.cur === '' ? 'true' : 'false'}
              aria-label={b.aria}
              onClick={() => key(b.k)}
            >
              {b.k === 'done' ? (editing ? '确定' : '完成') : b.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 一个胶囊切成两半：左半开关，右半改税率。
// 费率不是所有店都一样，改它必须和开关一样近。
function TaxCtl({ name, rate, on, onToggle, onEdit }) {
  return (
    <div className="tax-ctl" data-on={on ? 'true' : 'false'}>
      <button type="button" className="tax-toggle" aria-pressed={on} onClick={onToggle}>
        {name}
      </button>
      <button type="button" className="tax-rate" aria-label={`修改${name}税率`} onClick={onEdit}>
        {rate}%
      </button>
    </div>
  )
}
