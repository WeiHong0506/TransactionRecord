import { useCallback, useEffect, useRef, useState } from 'react'
import { appUrl, supabase, syncConfigured } from './supabase.js'
import { getLastSyncAt, runSync, signInWithGoogle, signOut } from './sync.js'

const DEBOUNCE_MS = 2500

/**
 * 把登录状态和同步调度收在一处。
 * 自动同步的时机：登录成功、记完一笔（防抖）、回到前台、网络恢复。
 */
export function useSync(onDataChanged) {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('idle') // idle | syncing | error
  const [error, setError] = useState(null)
  const [lastAt, setLastAt] = useState(null)

  const timer = useRef(null)
  const sessionRef = useRef(null)
  sessionRef.current = session

  useEffect(() => {
    if (!syncConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    getLastSyncAt().then(setLastAt)
    return () => sub.subscription.unsubscribe()
  }, [])

  const sync = useCallback(async () => {
    const uid = sessionRef.current?.user?.id
    if (!uid || !navigator.onLine) return
    setStatus('syncing')
    setError(null)
    try {
      const res = await runSync(uid)
      if (res) {
        setLastAt(res.at)
        // 云端有新数据进来时才刷新界面，避免无谓重渲染
        if (res.pulled > 0) await onDataChanged?.()
      }
      setStatus('idle')
    } catch (e) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }, [onDataChanged])

  // 本地写入后延迟同步：连着记好几笔只会触发一次上传
  const scheduleSync = useCallback(() => {
    if (!sessionRef.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(sync, DEBOUNCE_MS)
  }, [sync])

  useEffect(() => {
    if (session) sync()
  }, [session, sync])

  useEffect(() => {
    if (!syncConfigured) return
    const onFocus = () => document.visibilityState === 'visible' && sync()
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', sync)
    return () => {
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('online', sync)
      clearTimeout(timer.current)
    }
  }, [sync])

  return {
    configured: syncConfigured,
    session,
    status,
    error,
    lastAt,
    sync,
    scheduleSync,
    signIn: () => signInWithGoogle(appUrl()),
    signOut: async () => {
      await signOut()
      setLastAt(null)
    },
  }
}
