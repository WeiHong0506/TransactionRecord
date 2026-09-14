/**
 * 悬浮胶囊底栏。
 *
 * 两个 tab 装在一个胶囊里，选中项用一块高亮底衬 + 主色图标文字；
 * 「记一笔」是独立的圆形按钮，浮在胶囊右边——记账是最高频的动作，
 * 不该和导航挤在一起，也不该藏进二级页面。
 *
 * 图标用内联 SVG 而不是 emoji：emoji 没法跟着选中态变色。
 */

const Icon = ({ name }) => {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (name === 'stats') {
    return (
      <svg {...common}>
        <rect x="3" y="13" width="4.5" height="8" rx="1.4" />
        <rect x="9.75" y="8" width="4.5" height="13" rx="1.4" />
        <rect x="16.5" y="3" width="4.5" height="18" rx="1.4" />
      </svg>
    )
  }
  if (name === 'wallet') {
    return (
      <svg {...common}>
        <path d="M12 3 21.5 7.5 12 12 2.5 7.5 12 3Z" />
        <path d="M2.5 12.4 12 16.9l9.5-4.5" />
        <path d="M2.5 16.9 12 21.4l9.5-4.5" />
      </svg>
    )
  }
  return (
    <svg {...common} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

const TABS = [
  { id: 'stats', label: '统计', icon: 'stats' },
  { id: 'accounts', label: '资产', icon: 'wallet' },
]

export default function TabBar({ tab, setTab, onAdd }) {
  return (
    <nav className="tabbar">
      <div className="dock">
        {TABS.map((t) => {
          // 设置页是从资产页进去的二级页面，高亮仍留在「资产」上
          const active = tab === t.id || (t.id === 'accounts' && tab === 'settings')
          return (
            <button
              key={t.id}
              className={`dock-tab ${active ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={t.icon} />
              <span className="lb">{t.label}</span>
            </button>
          )
        })}
      </div>

      <button className="fab" onClick={onAdd} aria-label="记一笔">
        <Icon name="plus" />
      </button>
    </nav>
  )
}
