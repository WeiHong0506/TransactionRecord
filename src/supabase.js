import { createClient } from '@supabase/supabase-js'

// 构建时由 Vite 注入（见 .env.local 或 GitHub Actions 的 repository variables）
const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// 没配参数时整个同步功能静默关闭，应用退回纯本地模式，不报错也不显示登录入口
export const syncConfigured = Boolean(URL && KEY)

export const supabase = syncConfigured
  ? createClient(URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // 处理 Google 登录回跳带回来的 code
        flowType: 'pkce',
      },
    })
  : null

// 登录后回到应用自身的地址（GitHub Pages 带子路径，不能写成根路径）
export function appUrl() {
  return window.location.origin + import.meta.env.BASE_URL
}
