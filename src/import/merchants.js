/**
 * 商户名 → 分类。对账单导入和收据截图导入共用这一份。
 *
 * 单独拎出来是因为两边认的是同一批马来西亚商户。各留一份的话，
 * 你在一边教会应用「ZUS 是餐饮」，另一边还是不认识，那种不一致最招人烦。
 */

export const MERCHANT_RULES = [
  ['exp-food', /mixue|mcdonald|kfc|starbucks|zus|tealive|chagee|foodpanda|grabfood|restoran|restaurant|kopitiam|cafe|bakery|nasi|pizza|habib|huamui|secret recipe|oldtown|texas chicken|subway|domino|f&b|makan|corner/i],
  ['exp-transport', /grab(?!food)|rapid|mrt|lrt|ktm|shell|petronas|petron|caltex|bhp|parking|smart\s*tag|toll|myrapid|airasia|ets|amano|touch\s*'?n\s*go.*toll/i],
  ['exp-shopping', /shopee|lazada|mydin|aeon|tesco|lotus|giant|econsave|uniqlo|padini|decathlon|ikea|nsk/i],
  ['exp-daily', /7[\s-]*eleven|kk\s*super|familymart|99\s*speed|speedmart|watson|guardian|caring|mr\.?\s*diy/i],
  ['exp-fun', /gsc|tgv|mbo|cinema|netflix|spotify|steam|playstation|karaoke|golf|gym/i],
  ['exp-health', /clinic|klinik|pharmacy|farmasi|hospital|dental|dentist|medical/i],
  ['exp-housing', /tnb|syabas|air\s*selangor|indah\s*water|unifi|astro|time\s*fibre|rental|sewa/i],
  ['exp-comm', /maxis|celcom|digi|umobile|yes\s*4g|hotlink|tune\s*talk|xpax/i],
  ['exp-edu', /tuition|academy|udemy|coursera|bookstore|popular\b|mph\b/i],
]

/**
 * 猜分类。猜不出返回 null——返回「其他」会让人以为应用想过了，
 * 而 null 能让界面老实说「没认出来，你选一个」。
 */
export function guessCategory(description, learned) {
  const text = String(description || '')
  if (!text.trim()) return null
  // 用户自己教过的规则优先——它比内置列表更懂你的消费
  for (const [kw, catId] of Object.entries(learned || {})) {
    if (kw && text.toLowerCase().includes(kw.toLowerCase())) return catId
  }
  for (const [catId, re] of MERCHANT_RULES) {
    if (re.test(text)) return catId
  }
  return null
}

/**
 * 清掉流水号：8 位以上、含数字的连续串一律去掉。
 *
 * 商户名里几乎不会出现这种东西（「99 Speedmart」「7-Eleven」都很短），
 * 而参考号、账号、订单号全长这样。它们对记账毫无意义，
 * 留在备注里只会让明细变得没法读。
 */
export function stripIds(s) {
  return String(s ?? '')
    .replace(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
