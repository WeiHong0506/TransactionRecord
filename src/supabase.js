import { createClient } from '@supabase/supabase-js'

// 连接参数。
//
// 这两个值是「可公开」的：publishable key 设计上就要放进前端代码里，任何打开
// 网页的人都能从打包产物中读到。真正拦住越权访问的是数据库的 RLS 行级安全策略
// （见 supabase-schema.sql）——每个人只能读写自己的行。所以直接写在源码里是
// 安全的，也省掉了「构建环境读不读得到 .env」这一整类问题。
//
// 真正不能公开的是 service_role key，那个永远不要出现在前端。
//
// 换项目时改这两行，或用 .env / .env.local 覆盖（环境变量优先）。
const FALLBACK_URL = 'https://mkoynerkogxiuwtcfpkl.supabase.co'
const FALLBACK_KEY = 'sb_publishable_wDtZNrxOe7NJCy6Mu4_NWQ_1DmHEeFm'

// 用可选链，这样这个模块在 Node 里（跑单元测试时）也能被 import
const URL = import.meta.env?.VITE_SUPABASE_URL || FALLBACK_URL
const KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY

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
  return window.location.origin + (import.meta.env?.BASE_URL ?? '/')
}
