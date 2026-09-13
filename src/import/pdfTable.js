/**
 * 从 PDF 里还原表格。
 *
 * PDF 没有「表格」这个概念，只有一堆带坐标的文字块。所以要自己还原结构：
 *   1. 把文字块换算到「显示坐标」——页面可能是旋转的
 *   2. y 坐标相近的文字块归为同一视觉行
 *   3. 用表头那一行的 x 坐标切出列边界
 *   4. 每个文字块按 x 落进对应的列
 *   5. 首列有日期的行开启一条新记录；首列为空的行是上一条的折行续写
 *
 * 第 1 步不能省：横向表格常常画在纵向页面上再靠 /Rotate 转正。
 * 直接用 PDF 用户空间的坐标分组，得到的会是「列」而不是「行」——
 * 表面上能跑，实际上每一行都是一整列的内容拼在一起，全盘错位。
 */

// pdf.js 体积不小，只在真正要导入时才加载，不进主包。
// 固定在 v4：v6 用了 Map.getOrInsertComputed 这类很新的语法，老手机浏览器会直接报错。
let pdfjsPromise = null
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/**
 * 加密 PDF 的专用错误。
 * 银行和电子钱包的对账单基本都加密，所以这不是异常情况而是常规路径——
 * 要让调用方能区分「需要密码」和「密码不对」，才能给出有用的提示。
 */
export class PdfPasswordError extends Error {
  constructor(wrong) {
    super(wrong ? '密码不正确' : '这份 PDF 有密码保护')
    this.name = 'PdfPasswordError'
    this.wrong = wrong
  }
}

const Y_TOLERANCE = 3 // 同一行的 y 容差（约等于 pt）

/**
 * 候选朝向。
 *
 * 用 viewport 变换算出的显示坐标通常就是对的（朝向 A）。但有些 PDF 是把
 * 文字本身按 90° 画上去、页面却没有 /Rotate 标记，这时显示坐标依然是转过的。
 * 与其猜，不如都试一遍，选能找到表头的那个——判据客观，不依赖对生成器的假设。
 */
const ORIENTATIONS = [
  { name: '正常', map: (x, y) => ({ x, y }) },
  { name: '顺时针 90°', map: (x, y) => ({ x: y, y: -x }) },
  { name: '逆时针 90°', map: (x, y) => ({ x: -y, y: x }) },
]

/** 把文字块按 y 合并成视觉行，每行内按 x 排序，行间从上到下 */
function groupIntoLines(items) {
  const lines = []
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Y_TOLERANCE)
    if (line) {
      line.items.push(it)
      line.y = (line.y * (line.items.length - 1) + it.y) / line.items.length
    } else {
      lines.push({ y: it.y, items: [it] })
    }
  }
  lines.sort((a, b) => a.y - b.y)
  for (const l of lines) l.items.sort((a, b) => a.x - b.x)
  return lines
}

/**
 * 从表头行推出列边界。
 * 每列的起点取表头文字的 x，边界取相邻两列起点的中点。
 */
function columnsFromHeader(headerLine) {
  const starts = headerLine.items.map((i) => ({ x: i.x, name: i.text.trim() }))
  return starts.map((s, i) => ({
    name: s.name,
    // 首列左边界放到负无穷，避免略微左突的文字被丢掉
    min: i === 0 ? -Infinity : (starts[i - 1].x + s.x) / 2,
    max: i === starts.length - 1 ? Infinity : (s.x + starts[i + 1].x) / 2,
  }))
}

function assignToColumns(line, columns) {
  const cells = columns.map(() => [])
  for (const it of line.items) {
    const idx = columns.findIndex((c) => it.x >= c.min && it.x < c.max)
    if (idx >= 0) cells[idx].push(it.text.trim())
  }
  return cells.map((parts) => parts.join(' ').trim())
}

/** 在某个朝向下解析所有页面 */
function buildTable(pages, orientation, { headerMatch, isRecordStart, isContinuation }) {
  let columns = null
  const rows = []
  const rawLines = []
  const ignored = []

  for (const items of pages) {
    const mapped = items.map((it) => ({ ...orientation.map(it.x, it.y), text: it.text }))
    for (const line of groupIntoLines(mapped)) {
      const flat = line.items.map((i) => i.text).join(' ')
      rawLines.push(flat)

      // 一份对账单可能有多张表（例如钱包流水之后还有 GO+ 理财流水），
      // 每遇到表头就重新取列边界，而不是只认第一张表。
      if (headerMatch(flat)) {
        columns = columnsFromHeader(line)
        continue
      }
      if (!columns) continue // 表头之前的抬头信息一律跳过

      const cells = assignToColumns(line, columns)
      if (isRecordStart(cells)) {
        rows.push({ cells, columns: columns.map((c) => c.name) })
        continue
      }
      // 不是记录开头：要么是折行续写，要么是页脚/小计之类的噪音。
      // 判不准时宁可忽略，也不要污染上一条记录。
      const looksLikeContinuation = isContinuation ? isContinuation(cells) : true
      if (looksLikeContinuation && rows.length) {
        const last = rows[rows.length - 1].cells
        cells.forEach((v, i) => {
          if (v) last[i] = last[i] ? `${last[i]} ${v}` : v
        })
      } else {
        ignored.push(flat)
      }
    }
  }

  return { columns: columns?.map((c) => c.name) ?? null, rows, rawLines, ignored }
}

/**
 * 提取 PDF 里的表格。
 * @param file  用户选的 File
 * @param opts.headerMatch    用来认出表头行的函数
 * @param opts.isRecordStart  判断某行是否开启一条新记录（通常是首列有日期）
 * @param opts.isContinuation 判断某行是不是上一条记录的折行续写
 * @param opts.password       加密 PDF 的打开密码
 * @returns { columns, rows, rawLines, ignored, orientation }
 *   rows 每项是 { cells, columns }——多表文档里每条记录记住自己那张表的列名
 */
export async function extractTable(
  file,
  { headerMatch, isRecordStart, isContinuation, password }
) {
  const pdfjs = await getPdfjs()
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buf, password: password || undefined })

  let doc
  try {
    doc = await loadingTask.promise
  } catch (err) {
    if (err?.name === 'PasswordException') {
      // code 1 = 需要密码，2 = 密码不对
      throw new PdfPasswordError(err.code === 2)
    }
    throw err
  }

  // 先把所有页的文字块取出来（换算到显示坐标），再决定朝向
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = []
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue
      // 关键一步：把文字坐标换算到页面实际显示的方向上
      const m = pdfjs.Util.transform(viewport.transform, it.transform)
      items.push({ x: m[4], y: m[5], text: it.str })
    }
    pages.push(items)
  }
  await loadingTask.destroy()

  const opts = { headerMatch, isRecordStart, isContinuation }
  let best = null
  for (const orientation of ORIENTATIONS) {
    const result = buildTable(pages, orientation, opts)
    // 选中的标准：既找到表头，又真的解析出了记录
    if (result.columns && result.rows.length) {
      return { ...result, orientation: orientation.name }
    }
    if (!best || (result.columns && !best.columns)) {
      best = { ...result, orientation: orientation.name }
    }
  }
  return best
}
