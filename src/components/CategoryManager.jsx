import { useState } from 'react'
import Sheet from './Sheet.jsx'
import { CATEGORY_ICON_CHOICES, SERIES_SLOTS } from '../categories.js'
import { newId } from '../db.js'

export default function CategoryManager({ categories, onSave, onDelete, onClose }) {
  const [type, setType] = useState('expense')
  const [editing, setEditing] = useState(null)

  const list = categories.filter((c) => c.type === type)

  function startNew() {
    const used = new Set(list.map((c) => c.slot))
    const slot = SERIES_SLOTS.find((s) => !used.has(s)) ?? 1
    setEditing({
      id: newId(),
      name: '',
      icon: '✨',
      type,
      slot,
      order: Math.max(0, ...categories.map((c) => c.order)) + 1,
      isNew: true,
    })
  }

  if (editing) {
    return (
      <Sheet onClose={() => setEditing(null)}>
        <div className="sheet-head">
          <h3>{editing.isNew ? '新增分类' : '编辑分类'}</h3>
          {!editing.isNew && (
            <button
              className="link"
              onClick={() => {
                onDelete(editing.id)
                setEditing(null)
              }}
            >
              删除
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="cname">名称</label>
          <input
            id="cname"
            className="input"
            maxLength={8}
            placeholder="例如：人情"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            autoFocus
          />
        </div>

        <div className="field">
          <span className="field-label">图标</span>
          <div className="cat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {CATEGORY_ICON_CHOICES.map((ic) => (
              <button
                key={ic}
                className="cat-chip"
                aria-pressed={editing.icon === ic}
                onClick={() => setEditing({ ...editing, icon: ic })}
                style={{ padding: '9px 0 7px' }}
              >
                <span className="e">{ic}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">图表颜色</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[0, ...SERIES_SLOTS].map((s) => (
              <button
                key={s}
                aria-label={`颜色 ${s}`}
                aria-pressed={editing.slot === s}
                onClick={() => setEditing({ ...editing, slot: s })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: `var(--series-${s})`,
                  outline: editing.slot === s ? '2px solid var(--text-primary)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        <button
          className="btn"
          disabled={!editing.name.trim()}
          onClick={() => {
            const { isNew, ...rest } = editing
            onSave({ ...rest, name: rest.name.trim() })
            setEditing(null)
          }}
        >
          保存
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-head">
        <h3>分类管理</h3>
      </div>

      <div className="seg" role="group" aria-label="分类类型">
        <button aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
          支出分类
        </button>
        <button aria-pressed={type === 'income'} onClick={() => setType('income')}>
          收入分类
        </button>
      </div>

      <div className="card">
        {list.map((c) => (
          <button className="list-item" key={c.id} onClick={() => setEditing({ ...c })}>
            <span className="emoji" style={{ width: 34, height: 34, fontSize: 17 }}>
              {c.icon}
            </span>
            <span className="li-main">
              <span className="li-title">{c.name}</span>
            </span>
            <span
              className="sw"
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: `var(--series-${c.slot})`,
              }}
            />
            <span className="li-right">编辑</span>
          </button>
        ))}
      </div>

      <button className="btn secondary slim" onClick={startNew}>
        ＋ 新增{type === 'expense' ? '支出' : '收入'}分类
      </button>

      <p className="note-box" style={{ marginTop: 14 }}>
        删除分类不会删除已有记录，那些记录会显示为「未分类」。图表最多同时显示 7
        个分类，其余自动归入「其他分类」——这是为了保证颜色之间始终能被区分开。
      </p>
    </Sheet>
  )
}
