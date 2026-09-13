import { useRef, useState } from 'react'
import { CURRENCIES, csvEscape, downloadBlob } from '../utils.js'
import { clearAllData, exportAll, importAll } from '../db.js'
import SyncPanel from './SyncPanel.jsx'

// 改动代码时手动 +1。线上「关于」里会显示，用来确认部署的到底是哪一版。
const APP_VERSION = 'v1.6.0'

// iOS 的独立窗口模式里 <a download> 经常被吞掉，优先走系统分享面板
async function deliverFile(content, filename, mime) {
  const file = new File([content], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return '已打开分享面板，选「存储到文件」即可'
    } catch (err) {
      if (err?.name === 'AbortError') return null
    }
  }
  downloadBlob(content, filename, mime)
  return '已导出：' + filename
}

export default function Settings({
  currency,
  onCurrencyChange,
  theme,
  onThemeChange,
  lastBackup,
  onOpenCategories,
  onOpenImport,
  onReload,
  toast,
  records,
  categories,
  sync,
}) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  async function exportJSON() {
    setBusy(true)
    try {
      const data = await exportAll()
      const name = `记账备份-${new Date().toISOString().slice(0, 10)}.json`
      const msg = await deliverFile(JSON.stringify(data, null, 2), name, 'application/json')
      if (msg) {
        localStorage.setItem('lastBackup', new Date().toISOString())
        toast(msg)
        onReload()
      }
    } finally {
      setBusy(false)
    }
  }

  async function exportCSV() {
    setBusy(true)
    try {
      const byId = new Map(categories.map((c) => [c.id, c]))
      const head = ['日期', '类型', '分类', '金额', '备注']
      const lines = [head.join(',')]
      for (const t of [...records].sort((a, b) => (a.date < b.date ? -1 : 1))) {
        lines.push(
          [
            t.date,
            t.type === 'expense' ? '支出' : '收入',
            byId.get(t.categoryId)?.name ?? '未分类',
            Number(t.amount).toFixed(2),
            csvEscape(t.note || ''),
          ].join(',')
        )
      }
      // BOM 让 Excel 正确识别 UTF-8 中文
      const csv = '﻿' + lines.join('\n')
      const name = `记账明细-${new Date().toISOString().slice(0, 10)}.csv`
      const msg = await deliverFile(csv, name, 'text/csv;charset=utf-8')
      if (msg) toast(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const n = await importAll(data, 'merge')
      toast(`已导入 ${n} 笔记录`)
      onReload()
      sync?.scheduleSync?.()
    } catch (err) {
      toast(err.message || '导入失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    const extra = sync?.session
      ? '\n\n你已登录云端同步，这次清空会同步到你所有已登录的设备。'
      : ''
    if (!window.confirm('确定清空全部记账数据？此操作无法撤销，建议先导出备份。' + extra)) return
    await clearAllData()
    toast('数据已清空')
    onReload()
    sync?.scheduleSync?.()
  }

  return (
    <div>
      <SyncPanel sync={sync} toast={toast} />

      <div className="section">
        <div className="section-head">
          <h2>偏好</h2>
        </div>
        <div className="card">
          <div className="list-item">
            <span className="li-main">
              <span className="li-title">货币符号</span>
            </span>
            <select
              className="input"
              style={{ width: 'auto', padding: '7px 10px' }}
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="list-item">
            <span className="li-main">
              <span className="li-title">外观</span>
            </span>
            <select
              className="input"
              style={{ width: 'auto', padding: '7px 10px' }}
              value={theme}
              onChange={(e) => onThemeChange(e.target.value)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <button className="list-item" onClick={onOpenCategories}>
            <span className="li-main">
              <span className="li-title">分类管理</span>
              <span className="li-sub">增删改分类、换图标和颜色</span>
            </span>
            <span className="li-right">›</span>
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>数据备份</h2>
          <span className="hint">
            {lastBackup ? `上次备份 ${lastBackup.slice(0, 10)}` : '还没备份过'}
          </span>
        </div>
        <div className="card">
          <button className="list-item" onClick={exportJSON} disabled={busy}>
            <span className="li-main">
              <span className="li-title">导出备份（JSON）</span>
              <span className="li-sub">完整数据，可再导入回来</span>
            </span>
            <span className="li-right">↓</span>
          </button>
          <button className="list-item" onClick={exportCSV} disabled={busy}>
            <span className="li-main">
              <span className="li-title">导出明细（CSV）</span>
              <span className="li-sub">用 Excel / 表格软件打开</span>
            </span>
            <span className="li-right">↓</span>
          </button>
          <button className="list-item" onClick={() => fileRef.current?.click()} disabled={busy}>
            <span className="li-main">
              <span className="li-title">导入备份</span>
              <span className="li-sub">与现有数据合并，同一笔会覆盖</span>
            </span>
            <span className="li-right">↑</span>
          </button>
          <button className="list-item" onClick={onOpenImport} disabled={busy}>
            <span className="li-main">
              <span className="li-title">导入对账单（PDF）</span>
              <span className="li-sub">TnG eWallet 账单，解析全程在本机</span>
            </span>
            <span className="li-right">›</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleImport}
          />
        </div>
        <p className="note-box" style={{ marginTop: 12 }}>
          {sync?.session ? (
            <>
              ✅ 你已开启云端同步，数据在你的 Supabase 账户里有一份，换设备登录即可恢复。
              导出备份仍然值得做——它不依赖任何服务，是最后一道保险。
            </>
          ) : (
            <>
              ⚠️ 数据保存在这台设备的浏览器里，不会上传到任何服务器。iOS
              在长期不打开网页应用时可能清理本地数据，<strong>请定期导出备份</strong>，
              存到「文件」或 iCloud 云盘。换手机时用导入功能恢复。
            </>
          )}
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>危险操作</h2>
        </div>
        <div className="card">
          <button className="list-item" onClick={handleClear}>
            <span className="li-main">
              <span className="li-title" style={{ color: 'var(--danger)' }}>
                清空全部数据
              </span>
              <span className="li-sub">删除所有记录并恢复默认分类</span>
            </span>
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>关于</h2>
        </div>
        <div className="card card-pad">
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            记账本 · 离线优先的个人记账工具
            <br />
            版本 {APP_VERSION} · 同步 {sync?.configured ? '已配置' : '未配置'}
            <br />
            共 {records.length} 笔记录 · {categories.length} 个分类
            <br />
            <br />
            <strong>装到主屏幕：</strong>
            <br />
            iPhone — Safari 打开本页 → 底部「分享」→ 「添加到主屏幕」
            <br />
            Android — Chrome 菜单 → 「安装应用」
          </p>
        </div>
      </div>
    </div>
  )
}
