/**
 * 从 PDF 里还原表格。
 *
 * PDF 没有「表格」这个概念，只有一堆带坐标的文字块。所以要自己还原结构：
 *   1. y 坐标相近的文字块归为同一视觉行
 *   2. 用表头那一行的 x 坐标切出列边界
 *   3. 每个文字块按 x 落进对应的列
 *   4. Date 列有日期的行开启一条新记录；没有日期的行是上一条的折行续写
 *
 * 第 4 步是关键——对账单里 Description 经常折成两三行，
 * 按视觉行直接当记录会把一条拆成好几条。
 */

// pdf.js 体积不小，只在真正要导入时才加载，不进主包
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

const Y_TOLERANCE = 3 // 同一行的 y 容差（PDF 单位，约等于 pt）

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

/** 把一页的文字块按 y 合并成视觉行，每行内按 x 排序 */
function groupIntoLines(items) {
  const lines = []
  for (const it of items) {
    const text = it.str
    if (!text || !text.trim()) continue
    const x = it.transform[4]
    const y = it.transform[5]
    const line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE)
    if (line) {
      line.items.push({ x, text })
      line.y = (line.y * (line.items.length - 1) + y) / line.items.length
    } else {
      lines.push({ y, items: [{ x, text }] })
    }
  }
  // PDF 的 y 轴朝上，所以从大到小才是从上到下
  lines.sort((a, b) => b.y - a.y)
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
    // 第一列左边界放到负无穷，避免略微左突的文字被丢掉
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

/**
 * 提取 PDF 里的表格。
 * @param file  用户选的 File
 * @param opts.headerMatch    用来认出表头行的函数
 * @param opts.isRecordStart   判断某行是否开启一条新记录（通常是第一列有日期）
 * @param opts.isContinuation  判断某行是不是上一条记录的折行续写。
 *   不提供的话，所有非记录行都会被当成续写——页脚的「合计」之类会污染最后一条记录。
 * @param opts.password        加密 PDF 的打开密码
 * @returns { columns, rows, rawLines }  rawLines 供解析失败时排查用
 */
export async function extractTable(
  file,
  { headerMatch, isRecordStart, isContinuation, password }
) {
  const pdfjs = await getPdfjs()
  const buf = await file.arrayBuffer()
  // 释放要通过 loadingTask，PDFDocumentProxy 本身没有 destroy()
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

  let columns = null
  const rows = []
  const rawLines = []
  const ignored = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const lines = groupIntoLines(content.items)

    for (const line of lines) {
      const flat = line.items.map((i) => i.text).join(' ')
      rawLines.push(flat)

      if (!columns) {
        if (headerMatch(flat)) columns = columnsFromHeader(line)
        continue // 表头之前的内容（账号、期间等）一律跳过
      }
      // 后续页面会重复出现表头，跳过
      if (headerMatch(flat)) continue

      const cells = assignToColumns(line, columns)
      if (isRecordStart(cells)) {
        rows.push(cells)
        continue
      }
      // 不是记录开头：要么是折行续写，要么是页脚/小计之类的噪音。
      // 判不准时宁可忽略，也不要污染上一条记录。
      const looksLikeContinuation = isContinuation ? isContinuation(cells) : true
      if (looksLikeContinuation && rows.length) {
        const last = rows[rows.length - 1]
        cells.forEach((v, i) => {
          if (v) last[i] = last[i] ? `${last[i]} ${v}` : v
        })
      } else {
        ignored.push(flat)
      }
    }
  }

  await loadingTask.destroy()
  return { columns: columns?.map((c) => c.name) ?? null, rows, rawLines, ignored }
}
