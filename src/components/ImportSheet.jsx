import { useMemo, useRef, useState } from 'react'
import Sheet from './Sheet.jsx'
import { formatAmount, symbolOf } from '../utils.js'

const STATE = { IDLE: 'idle', PARSING: 'parsing', DONE: 'done', ERROR: 'error' }

export default function ImportSheet({
  accounts,
  categories,
  currency,
  defaultAccountId,
  onParse,
  onImport,
  onClose,
}) {
  const fileRef = useRef(null)
  const [state, setState] = useState(STATE.IDLE)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [rawLines, setRawLines] = useState([])
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState(null)
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? '')

  const expenseCats = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories])
  const incomeCats = useMemo(() => categories.filter((c) => c.type === 'income'), [categories])

  const selected = rows.filter((r) => r.include && !r.dup)
  const dupCount = rows.filter((r) => r.dup).length
  const excluded = rows.length - selected.length - dupCount

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setState(STATE.PARSING)
    setError(null)
    try {
      const res = await onParse(file)
      setRows(res.rows)
      setRawLines(res.rawLines ?? [])
      setWarnings(res.warnings ?? [])
      setState(STATE.DONE)
    } catch (err) {
      setError(err?.message || String(err))
      setState(STATE.ERROR)
    }
  }

  function patch(i, next) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)))
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-head">
        <h3>导入对账单</h3>
        {state === STATE.DONE && (
          <button className="link" style={{ color: 'var(--accent)' }} onClick={() => setState(STATE.IDLE)}>
            换个文件
          </button>
        )}
      </div>

      {state === STATE.IDLE && (
        <>
          <p className="note-box">
            支持 Touch&nbsp;'n&nbsp;Go eWallet 的 PDF 对账单。
            <br />
            <br />
            解析全程在你的浏览器里完成，<strong>文件不会上传到任何服务器</strong>。
            <br />
            <br />
            充值（Reload）、钱包间转账、收到他人转账会自动排除；扫码消费（DuitNow QR）记为支出。
            导入前可以逐条确认和修改。
          </p>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            选择 PDF 文件
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={handleFile} />
        </>
      )}

      {state === STATE.PARSING && (
        <div className="empty">
          <div className="big">📄</div>
          <p>正在解析 {fileName}…</p>
          <p>首次使用需要加载 PDF 解析模块，可能要几秒</p>
        </div>
      )}

      {state === STATE.ERROR && (
        <>
          <p className="note-box" style={{ color: 'var(--danger)' }}>
            解析失败：{error}
          </p>
          <button className="btn secondary" onClick={() => setState(STATE.IDLE)}>
            重新选择文件
          </button>
        </>
      )}

      {state === STATE.DONE && (
        <>
          <div className="import-summary">
            <div>
              <span className="n">{rows.length}</span>
              <span className="k">共解析</span>
            </div>
            <div>
              <span className="n" style={{ color: 'var(--accent)' }}>
                {selected.length}
              </span>
              <span className="k">将导入</span>
            </div>
            <div>
              <span className="n">{excluded}</span>
              <span className="k">已排除</span>
            </div>
            <div>
              <span className="n">{dupCount}</span>
              <span className="k">重复</span>
            </div>
          </div>

          {accounts.length > 1 && (
            <div className="field">
              <span className="field-label">导入到哪个账户</span>
              <div className="acct-picker">
                {accounts.map((a) => (
                  <button
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

          {warnings.length > 0 && (
            <details className="table-toggle" style={{ marginTop: 14 }}>
              <summary>{warnings.length} 条解析提醒</summary>
              <p className="note-box" style={{ marginTop: 8 }}>
                {warnings.slice(0, 12).map((w, i) => (
                  <span key={i}>
                    {w}
                    <br />
                  </span>
                ))}
              </p>
            </details>
          )}

          <div className="section" style={{ marginTop: 14 }}>
            <div className="section-head">
              <h2>逐条确认</h2>
              <span className="hint">取消勾选即不导入</span>
            </div>
            <div className="card">
              {rows.map((r, i) => {
                const cats = r.direction === 'income' ? incomeCats : expenseCats
                return (
                  <div className={`imp-row ${r.dup ? 'dup' : ''}`} key={i}>
                    <label className="imp-check">
                      <input
                        type="checkbox"
                        checked={r.include && !r.dup}
                        disabled={r.dup}
                        onChange={(e) => patch(i, { include: e.target.checked })}
                      />
                    </label>
                    <div className="imp-main">
                      <div className="imp-top">
                        <span className="imp-desc">{r.description || r.type}</span>
                        <span className={`imp-amt ${r.direction}`}>
                          {r.direction === 'income' ? '+' : '-'}
                          {formatAmount(r.amount)}
                        </span>
                      </div>
                      <div className="imp-meta">
                        {r.date} · {r.type}
                        {r.dup && ' · 已导入过'}
                        {!r.dup && r.action === 'exclude' && ` · ${r.why}`}
                        {!r.dup && r.action === 'unknown' && ' · ⚠️ 未知类型'}
                      </div>
                      {r.include && !r.dup && (
                        <div className="imp-controls">
                          <select
                            className="input imp-select"
                            value={r.direction}
                            onChange={(e) => patch(i, { direction: e.target.value, categoryId: null })}
                          >
                            <option value="expense">支出</option>
                            <option value="income">收入</option>
                          </select>
                          <select
                            className="input imp-select"
                            value={r.categoryId ?? ''}
                            onChange={(e) => patch(i, { categoryId: e.target.value })}
                          >
                            <option value="">选择分类…</option>
                            {cats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.icon} {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {rawLines.length > 0 && (
            <details className="table-toggle">
              <summary>查看 PDF 原始文本（解析不对时排查用）</summary>
              <pre className="raw-text">{rawLines.slice(0, 200).join('\n')}</pre>
            </details>
          )}

          <button
            className="btn"
            disabled={!selected.length || !accountId || selected.some((r) => !r.categoryId)}
            onClick={() => onImport(selected, accountId)}
          >
            {selected.some((r) => !r.categoryId)
              ? '还有记录没选分类'
              : `导入 ${selected.length} 笔到${accounts.find((a) => a.id === accountId)?.name ?? ''}`}
          </button>
          <p className="cal-hint">
            合计 {symbolOf(currency)}{' '}
            {formatAmount(selected.reduce((s, r) => s + (r.direction === 'expense' ? r.amount : 0), 0))} 支出
          </p>
        </>
      )}
    </Sheet>
  )
}
