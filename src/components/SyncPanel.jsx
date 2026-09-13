function relativeTime(ms) {
  if (!ms) return '还没同步过'
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚同步'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前同步`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前同步`
  return `${new Date(ms).toLocaleDateString('zh-CN')} 同步`
}

export default function SyncPanel({ sync, toast }) {
  // 没配置 Supabase 参数时整块不显示，应用就是纯本地版
  if (!sync.configured) return null

  const { session, status, error, lastAt } = sync
  const user = session?.user

  return (
    <div className="section">
      <div className="section-head">
        <h2>云端同步</h2>
        {user && (
          <span className="hint">
            {status === 'syncing' ? '同步中…' : status === 'error' ? '同步失败' : relativeTime(lastAt)}
          </span>
        )}
      </div>

      {!user ? (
        <>
          <div className="card">
            <button
              className="list-item"
              onClick={async () => {
                try {
                  await sync.signIn()
                } catch (e) {
                  toast(e.message)
                }
              }}
            >
              <span className="emoji" style={{ width: 34, height: 34, fontSize: 16 }}>
                🔗
              </span>
              <span className="li-main">
                <span className="li-title">用 Google 登录以同步</span>
                <span className="li-sub">手机、电脑记的账自动合并到一起</span>
              </span>
              <span className="li-right">›</span>
            </button>
          </div>
          <p className="note-box" style={{ marginTop: 12 }}>
            不登录也能正常用——数据存在本机，功能一个不少。登录只是多一层云端备份和多设备合并。
          </p>
        </>
      ) : (
        <>
          <div className="card">
            <div className="list-item">
              <span className="emoji" style={{ width: 34, height: 34, fontSize: 16 }}>
                ✅
              </span>
              <span className="li-main">
                <span className="li-title">{user.email}</span>
                <span className="li-sub">
                  {status === 'error' ? error : relativeTime(lastAt)}
                </span>
              </span>
            </div>
            <button
              className="list-item"
              disabled={status === 'syncing'}
              onClick={async () => {
                await sync.sync()
                toast('同步完成')
              }}
            >
              <span className="li-main">
                <span className="li-title">立即同步</span>
                <span className="li-sub">平时会自动同步，这里可以手动触发一次</span>
              </span>
              <span className="li-right">{status === 'syncing' ? '⟳' : '↻'}</span>
            </button>
            <button
              className="list-item"
              onClick={async () => {
                if (!window.confirm('退出登录？本地数据会保留，不会删除。')) return
                await sync.signOut()
                toast('已退出登录')
              }}
            >
              <span className="li-main">
                <span className="li-title" style={{ color: 'var(--danger)' }}>
                  退出登录
                </span>
                <span className="li-sub">本地数据保留</span>
              </span>
            </button>
          </div>
          {status === 'error' && (
            <p className="note-box" style={{ marginTop: 12, color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
