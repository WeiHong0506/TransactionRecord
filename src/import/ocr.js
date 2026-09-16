/**
 * 截图文字识别。跑在浏览器里，图片不上传。
 *
 * 说清楚边界，免得「不上传」变成一句含糊的承诺：
 *   · 你的截图**从头到尾只存在于这台设备的内存里**，不会发给任何服务器，
 *     也不会存进数据库——认完字就丢。
 *   · 首次使用要下载识别模型（约 6MB），这一步需要联网。下载的是模型，不是你的图。
 *   · 模型托管在**这个应用自己的域名下**，不走第三方 CDN。多占几 MB 仓库，
 *     换来的是：没有任何请求发给外部服务，公司/校园网挡了 CDN 也照样能用。
 *
 * 只装英文模型。中文模型要再多 20MB，而 TnG 和大马银行收据上
 * 真正要认的东西——金额、日期、参考号、商户名——几乎全是拉丁字母和数字。
 */

// 和 vite 的 base 对齐：应用部署在子路径下，写死 '/ocr/' 会 404
const OCR_PATH = `${import.meta.env.BASE_URL}ocr`

let workerPromise = null

/**
 * 预处理：把图片画到 canvas 上，转灰度，必要时放大和反色。
 *
 * 反色这一步不是锦上添花。深色模式下的收据是「浅字深底」，
 * Tesseract 对这种图的识别率会掉到几乎不可用——而 iPhone 用户
 * 开深色模式截图是最常见的情况之一。
 */
export function preprocess(img) {
  const MIN_W = 1000
  const scale = img.naturalWidth < MIN_W ? Math.min(3, MIN_W / img.naturalWidth) : 1
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data

  // 先转灰度并顺便统计平均亮度
  let sum = 0
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
    px[i] = px[i + 1] = px[i + 2] = g
    sum += g
  }
  const mean = sum / (px.length / 4)

  // 平均偏暗 = 深色模式截图，整张反过来变成「深字浅底」
  const inverted = mean < 110
  if (inverted) {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = 255 - px[i]
    }
  }

  ctx.putImageData(data, 0, 0)
  return { canvas, inverted, scale }
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      // 动态导入：不点这个功能就永远不下载这几 MB
      const { createWorker } = await import('tesseract.js')
      return createWorker('eng', 1, {
        // 四个路径全指向自己的域名，一个外部请求都不发。
        // 漏掉 workerPath 的话，worker.min.js 仍会去 jsdelivr 拿——
        // 挡了 CDN 的网络下整个功能就废了，而且是静默卡住。
        workerPath: `${OCR_PATH}/worker.min.js`,
        corePath: OCR_PATH,
        langPath: OCR_PATH,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') onProgress?.('识别中', m.progress ?? 0)
          else if (m.status?.includes('loading') || m.status?.includes('initial')) {
            onProgress?.('首次使用，正在下载识别模型', m.progress ?? 0)
          }
        },
      })
    })().catch((err) => {
      // 失败就把 promise 清掉，下次点还能重试，而不是永远卡在坏掉的那次
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/** 把 File 读成 <img>。失败时抛出人能看懂的话。 */
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这个文件打不开，换一张截图试试。'))
    }
    img.src = url
  })
}

/**
 * 识别一张截图里的文字。
 * @returns { text, inverted }
 */
export async function recognizeImage(file, { onProgress } = {}) {
  const img = await loadImage(file)
  const { canvas, inverted } = preprocess(img)

  let worker
  try {
    worker = await getWorker(onProgress)
  } catch {
    throw new Error(
      '识别模型加载失败。首次使用需要联网，连上网再试一次；' +
        '或者用「粘贴文字」那条路——它不需要下载任何东西。'
    )
  }

  const { data } = await worker.recognize(canvas)
  // 用完就把画布尺寸清零，让这张图尽快离开内存
  canvas.width = 0
  canvas.height = 0
  return { text: data?.text ?? '', inverted }
}

/** 离开页面时收掉 worker，省得它在后台占着内存 */
export async function disposeOcr() {
  if (!workerPromise) return
  const p = workerPromise
  workerPromise = null
  try {
    const worker = await p
    await worker.terminate()
  } catch {
    // 本来就没起来，没什么可收的
  }
}
