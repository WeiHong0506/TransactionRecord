import { useEffect, useMemo, useRef, useState } from 'react'
import Sheet from './Sheet.jsx'
import { ISSUERS, parseReceipt } from '../import/receipt.js'
import { formatAmount, symbolOf, todayStr } from '../utils.js'

/**
 * 收据截图导入。
 *
 * 全程只有一条规矩：**识别结果绝不自动保存**。
 * OCR 把小数点认错一位，或者把钱包余额当成付款金额，都会往账本里
 * 塞一笔你一个月后完全对不上的假账。所以不管认得多准，
 * 最后都停在一个可编辑的预览上，等你按「保存」。
 *
 * 两条输入路：
 *   粘贴文字 —— 用 iOS 自带的实况文本拷贝，准确率最高，不下载任何东西
 *   选图识别 —— 省事，但首次要下载约 6MB 模型，且识别有误差
 */

const STEP = { PICK: 'pick', INPUT: 'input', REVIEW: 'review' }

export default function ReceiptSheet({
  accounts = [],
  categories = [],
  currency,
  defaultAccountId,
  existingFingerprints,
  learnedRules,
  onSave,
  onClose,
}) {
  const [step, setStep] = useState(STEP.PICK)
  const [issuer, setIssuer] = useState('tng')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null) // { label, pct }
  const [error, setError] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [copied, setCopied] = useState(false)

  // 预览里可编辑的字段
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayStr())
  const [direction, setDirection] = useState('expense')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? '')
  const [note, setNote] = useState('')

  const fileRef = useRef(null)

  // 离开时把 OCR worker 收掉，它会一直占着几十 MB 内存
  useEffect(() => {
    return () => {
      import('../import/ocr.js').then((m) => m.disposeOcr()).catch(() => {})
    }
  }, [])

  const cats = useMemo(
    () => categories.filter((c) => c.type === direction),
    [categories, direction]
  )

  function applyParsed(res) {
    setParsed(res)
    // 钱写成 12.5 看着像没写完，两位小数才是金额该有的样子
    setAmount(res.amount != null ? res.amount.toFixed(2) : '')
    setDate(res.date ?? todayStr())
    setDirection(res.direction)
    setCategoryId(res.categoryId ?? '')
    setNote(res.note ?? '')
    setStep(STEP.REVIEW)
  }

  function parseText(raw) {
    setError(null)
    const res = parseReceipt(raw, { issuerId: issuer, today: todayStr(), learnedRules })
    applyParsed(res)
  }

  async function handleImage(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(null)
    setBusy({ label: '准备中', pct: 0 })
    try {
      const { recognizeImage } = await import('../import/ocr.js')
      const { text: t } = await recognizeImage(f, {
        onProgress: (label, pct) => setBusy({ label, pct }),
      })
      setText(t)
      parseText(t)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const amountNum = Number(amount)
  const valid = Number.isFinite(amountNum) && amountNum > 0 && date && categoryId && accountId

  // 同一张截图导两次会撞上同一个指纹
  const fp = `${date}|${amountNum.toFixed(2)}|${note.trim().toLowerCase()}`
  const isDup = valid && existingFingerprints?.has(fp)

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-head">
        <h3>{step === STEP.REVIEW ? '核对这一笔' : '收据截图'}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <div className="rcp">
        {step === STEP.PICK && (
          <>
            <p className="rcp-lead">这张收据来自哪里？选对了，解析规则才对得上。</p>
            <div className="card">
              {ISSUERS.map((it) => (
                <button
                  key={it.id}
                  className="list-item"
                  onClick={() => {
                    setIssuer(it.id)
                    setStep(STEP.INPUT)
                  }}
                >
                  <span className="li-main">
                    <span className="li-title">
                      <span className="e">{it.icon}</span>
                      {it.name}
                    </span>
                  </span>
                  <span className="li-right">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === STEP.INPUT && (
          <>
            <button className="rcp-back" onClick={() => setStep(STEP.PICK)}>
              ‹ {ISSUERS.find((i) => i.id === issuer)?.name}
            </button>

            <div className="section">
              <div className="section-head">
                <h2>方式一：粘贴文字（更准）</h2>
              </div>
              <p className="rcp-lead">
                在相册里长按截图上的文字 →「全选」→「拷贝」，回到这里粘贴。
                用的是 iPhone 自带的文字识别，比应用内识别准得多，也不用下载任何东西。
              </p>
              <textarea
                className="input rcp-text"
                rows={5}
                placeholder="把收据上的文字粘贴到这里…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                className="btn"
                disabled={!text.trim()}
                onClick={() => parseText(text)}
              >
                解析这段文字
              </button>
            </div>

            <div className="section">
              <div className="section-head">
                <h2>方式二：直接选截图</h2>
              </div>
              <p className="rcp-lead">
                省两步，但会有识别误差，所以结果一定要核对。
                首次使用需要联网下载约 6MB 识别模型（托管在本站，不走第三方），之后离线也能用。
                <strong>你的截图不会上传到任何地方</strong>——认字全在这台设备上完成。
              </p>
              <button
                className="btn secondary"
                disabled={Boolean(busy)}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? `${busy.label}…` : '选择截图'}
              </button>
              {busy && (
                <div className="rcp-progress" role="progressbar" aria-valuenow={Math.round(busy.pct * 100)}>
                  <span style={{ width: `${Math.round(busy.pct * 100)}%` }} />
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleImage}
              />
            </div>

            {error && <p className="note-box warn">{error}</p>}
          </>
        )}

        {step === STEP.REVIEW && parsed && (
          <>
            <div className="rcp-verdict" data-level={parsed.confidence}>
              {parsed.confidence === 'high'
                ? '认出来了，核对一下就能存'
                : parsed.confidence === 'medium'
                  ? '认了个大概，请逐项核对'
                  : '没认全，下面的字段要你自己填'}
            </div>

            {parsed.warnings.length > 0 && (
              <ul className="rcp-warn">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            <div className="card card-pad rec-form">
              <div className="field">
                <span className="field-label">收支</span>
                <div className="seg">
                  <button
                    type="button"
                    aria-pressed={direction === 'expense'}
                    onClick={() => {
                      setDirection('expense')
                      setCategoryId('')
                    }}
                  >
                    支出
                  </button>
                  <button
                    type="button"
                    aria-pressed={direction === 'income'}
                    onClick={() => {
                      setDirection('income')
                      setCategoryId('')
                    }}
                  >
                    收入
                  </button>
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rcp-amount">
                  金额
                </label>
                <div className="rec-amount-row">
                  <span className="sym">{symbolOf(currency)}</span>
                  <input
                    id="rcp-amount"
                    className="input"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (/^\d{0,9}(\.\d{0,2})?$/.test(v)) setAmount(v)
                    }}
                  />
                </div>
                {/* 把依据摆出来，你一眼就能判断它挑对了没有 */}
                {parsed.amountLine && (
                  <p className="rcp-src">认自这一行：「{parsed.amountLine}」</p>
                )}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rcp-date">
                  日期
                </label>
                <input
                  id="rcp-date"
                  className="input"
                  type="date"
                  value={date}
                  max={todayStr()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="field">
                <span className="field-label">分类</span>
                <div className="cat-grid">
                  {cats.map((c) => (
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

              {accounts.length > 1 && (
                <div className="field">
                  <label className="field-label" htmlFor="rcp-account">
                    账户
                  </label>
                  <select
                    id="rcp-account"
                    className="input"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.icon} {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="rcp-note">
                  备注
                </label>
                <input
                  id="rcp-note"
                  className="input"
                  type="text"
                  value={note}
                  placeholder="商户或用途"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {parsed.reference && (
                <p className="rcp-src">
                  参考号 {parsed.reference}——只给你核对用，不会写进记录。
                </p>
              )}
            </div>

            {/* 认得不对时，原文就是唯一能拿来排查的东西。
                摊在这里 + 一键复制，免得还要退回上一步翻文本框。 */}
            <details className="table-toggle" open={parsed.confidence !== 'high'}>
              <summary>查看识别到的原文（认得不对时发给开发者）</summary>
              <pre className="raw-text">{text || '(空)'}</pre>
              <button
                className="btn secondary slim"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  } catch {
                    // 剪贴板被挡住时不装作成功——长按上面那段自己选也一样
                    setCopied('fail')
                    setTimeout(() => setCopied(false), 2400)
                  }
                }}
              >
                {copied === true ? '已复制' : copied === 'fail' ? '复制不了，长按上面选取' : '复制原文'}
              </button>
            </details>

            {isDup && (
              <p className="note-box warn">
                已经有一笔同日期、同金额、同备注的记录了。这张截图可能导过一次。
              </p>
            )}

            <button
              className="btn"
              disabled={!valid}
              onClick={() =>
                onSave({
                  type: direction,
                  amount: amountNum,
                  categoryId,
                  accountId,
                  date,
                  note: note.trim(),
                  // 参考号不进记录：它可能夹带账号片段
                })
              }
            >
              {valid ? `保存 ${symbolOf(currency)} ${formatAmount(amountNum)}` : '还缺字段'}
            </button>
            <button className="btn secondary slim" onClick={() => setStep(STEP.INPUT)}>
              返回上一步
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}
