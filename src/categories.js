// 分类的颜色存的是「槽位」而不是色值，这样浅色/深色模式各自取对应的 CSS 变量。
// 槽位顺序是经过色觉障碍（CVD）分离度校验的固定顺序，不要随意打乱。
export const SERIES_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8]
export const NEUTRAL_SLOT = 0 // 「其他」用中性灰

export const DEFAULT_CATEGORIES = [
  // 支出
  { id: 'exp-food', name: '餐饮', icon: '🍜', type: 'expense', slot: 1, order: 1 },
  { id: 'exp-transport', name: '交通', icon: '🚌', type: 'expense', slot: 2, order: 2 },
  { id: 'exp-shopping', name: '购物', icon: '🛍️', type: 'expense', slot: 3, order: 3 },
  { id: 'exp-housing', name: '居住', icon: '🏠', type: 'expense', slot: 4, order: 4 },
  { id: 'exp-fun', name: '娱乐', icon: '🎮', type: 'expense', slot: 5, order: 5 },
  { id: 'exp-daily', name: '日用', icon: '🧴', type: 'expense', slot: 6, order: 6 },
  { id: 'exp-health', name: '医疗', icon: '💊', type: 'expense', slot: 7, order: 7 },
  { id: 'exp-edu', name: '教育', icon: '📚', type: 'expense', slot: 8, order: 8 },
  // 色槽只有 8 个（顺序经过 CVD 校验），第 9 个有颜色的分类必然要跟人共用一个。
  // 通讯和医疗都不太会同时排进前几名，所以让它们共用槽位 7。
  { id: 'exp-comm', name: '通讯', icon: '📱', type: 'expense', slot: 7, order: 9 },
  { id: 'exp-other', name: '其他', icon: '📦', type: 'expense', slot: 0, order: 10 },
  // 收入
  { id: 'inc-salary', name: '工资', icon: '💰', type: 'income', slot: 1, order: 11 },
  { id: 'inc-parttime', name: '兼职', icon: '💼', type: 'income', slot: 3, order: 12 },
  { id: 'inc-invest', name: '投资', icon: '📈', type: 'income', slot: 6, order: 13 },
  { id: 'inc-gift', name: '红包', icon: '🧧', type: 'income', slot: 5, order: 14 },
  { id: 'inc-other', name: '其他', icon: '✨', type: 'income', slot: 0, order: 15 },
]

// 资金账户：现金、银行卡、电子钱包等。每笔流水都归属到一个账户。
export const DEFAULT_ACCOUNTS = [
  { id: 'acc-cash', name: '现金', icon: '💵', slot: 6, initialBalance: 0, order: 1, currency: 'MYR' },
]

export const ACCOUNT_ICON_CHOICES = [
  '💵', '💳', '🏦', '📱', '👛', '🪙', '💰', '🧧', '📈', '🏧',
]

export const CATEGORY_ICON_CHOICES = [
  '🍜', '☕', '🍎', '🚌', '⛽', '🚕', '🛍️', '👕', '🏠', '💡',
  '🧴', '🎮', '🎬', '✈️', '💊', '🏥', '📚', '✏️', '🎁', '🧧',
  '💰', '💼', '📈', '🐱', '🏋️', '💅', '🔧', '📱', '📦', '✨',
]

export function fallbackCategory(type) {
  return {
    id: type === 'income' ? 'inc-other' : 'exp-other',
    name: '未分类',
    icon: '❔',
    type,
    slot: 0,
    order: 999,
  }
}
