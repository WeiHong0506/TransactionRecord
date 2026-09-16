# 记账本 · TransactionRecord

离线优先的个人记账 PWA。一套代码同时是网站和「装到主屏幕」的应用，数据全部存在自己设备的浏览器里，不上传任何服务器。

- 收支记录、分类管理、月份切换
- **资金账户**：现金 / 银行卡 / 电子钱包分开记，各自余额与总资产一目了然
- 统计分两个视图：**分类构成**（占比环形图、近 6 个月收支对比、本月小结）和**日历**（每天的收支一目了然，点某天展开当日明细并可直接编辑）
- 完整离线可用（Service Worker 预缓存），断网照常记账
- 一键导出 JSON 备份 / CSV 明细，可再导入恢复
- **导入 PDF 对账单**（Touch 'n Go eWallet）：支持加密 PDF（输密码解锁）、自动识别充值/转账并排除、按商户名归类、重复导入自动去重。解析全程在浏览器里，文件和密码都不离开设备
- 浅色 / 深色两套配色，跟随系统或手动切换
- 默认马来西亚令吉（RM），可在设置里改

技术栈：Vite + React + IndexedDB，无后端、无第三方图表库（图表是手写 SVG）。

---

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173/TransactionRecord/
npm run build      # 产物在 dist/
npm run preview    # 本地预览生产构建
```

Node 20 以上。

---

## 部署到 GitHub Pages

仓库里已经带好 `.github/workflows/deploy.yml`，推代码就会自动构建部署。第一次需要手动开一下 Pages：

1. 仓库 **Settings → Pages**
2. **Source** 选 **GitHub Actions**（不要选 "Deploy from a branch"）
3. 回到 **Actions** 标签页，确认 workflow 跑成功（绿勾）
4. 站点地址：`https://weihong0506.github.io/TransactionRecord/`

> ⚠️ 免费账号的 **私有仓库无法使用 GitHub Pages**，仓库需要是 Public。代码公开不等于数据公开——记账数据只在你自己的手机里，仓库里只有程序代码。

### 路径前缀：PWA 最常见的坑

GitHub Pages 把站点放在子路径 `/TransactionRecord/` 下面。以下三处必须一致，否则加到主屏幕后会白屏、Service Worker 也注册不上：

| 位置 | 值 |
|---|---|
| `vite.config.js` 的 `base` | `/TransactionRecord/` |
| manifest 的 `start_url` | `/TransactionRecord/` |
| manifest 的 `scope` | `/TransactionRecord/` |

本项目把它们统一成 `vite.config.js` 顶部的一个 `BASE` 常量，改一处就够了。

**如果改了仓库名**，同步改掉 `BASE` 即可。

---

## 改用 Cloudflare Pages / Vercel（可选）

这两家支持私有仓库免费部署，站点在根路径，没有上面的子路径问题。

1. 把 `vite.config.js` 里的 `BASE` 改成 `'/'`
2. 在 Cloudflare Pages / Vercel 里连接这个 GitHub 仓库
3. 构建命令 `npm run build`，输出目录 `dist`

---

## 装到手机

PWA 必须走 HTTPS，`github.io` 自带 HTTPS，直接满足。

- **iPhone**：Safari 打开站点 → 底部「分享」→「添加到主屏幕」
  （必须用 Safari，Chrome for iOS 装不了）
- **Android**：Chrome 菜单 →「安装应用」/「添加到主屏幕」

装好之后全屏运行、有独立图标，断网也能打开。

---

## 云端同步（可选）

不登录也能完整使用——同步是叠加在本地数据库之上的一层，不是替代。

**设计：本地优先。** 记账永远先写进本机 IndexedDB，界面立刻更新，断网照常用。联网且已登录时，在后台双向同步：

- 每条记录带 `updatedAt`，冲突时**后写优先**
- 删除不是真删，而是写一个 `deletedAt` 墓碑，否则另一台设备永远不知道这条被删了
- 本地改动打 `dirty` 标记，联网时推上去；拉取只取比上次同步更新的行
- 同步时机：登录成功、记完一笔（防抖 2.5 秒）、回到前台、网络恢复

### 启用步骤

1. **建表**：Supabase 控制台 → SQL Editor，粘贴执行 `supabase-schema.sql`。
   脚本最后会输出两行，确认 `rls_enabled` 都是 `true`。
   > RLS 是整套方案的安全基石。publishable key 是公开的，没有 RLS 等于任何人都能读走所有人的账本。

2. **开启 Google 登录**：Supabase → Authentication → Providers → Google，
   填入从 Google Cloud Console 创建的 OAuth 客户端 ID / Secret。
   Google 那边的「已授权的重定向 URI」填：
   ```
   https://<项目ref>.supabase.co/auth/v1/callback
   ```

3. **配置回跳地址**：Supabase → Authentication → URL Configuration
   - Site URL：`https://weihong0506.github.io/TransactionRecord/`
   - Redirect URLs 再加一条本地开发用的：`http://localhost:5173/TransactionRecord/`

4. **填连接参数**：根目录 `.env` 里的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
   这两个值可以公开提交（安全性靠 RLS），CI 构建时会自动读取。
   **绝对不要**把 `service_role` key 放进来。

没配 `.env` 或参数为空时，同步功能整体静默关闭，界面上不会出现登录入口。

---

## 数据与备份

数据存在浏览器的 IndexedDB 里，**只在这一台设备上**，不会同步、不会上传。

⚠️ iOS 对网页应用的本地存储保护比 Android 弱，长期不打开可能被系统清理。**请定期在「设置 → 导出备份」存一份 JSON 到「文件」或 iCloud 云盘**，换手机时用「导入备份」恢复。

导出在 iOS 上会走系统分享面板（选「存储到文件」），在桌面浏览器上是直接下载。

---

## 目录结构

```
.github/workflows/deploy.yml   GitHub Pages 自动部署
public/icons/                  PWA 图标（scripts/make-icons.py 生成）
.env                           Supabase 连接参数（可公开，安全性靠 RLS）
supabase-schema.sql            云端建表 + 行级安全策略（含 accounts 表，可重复执行）
supabase-budgets.sql           v1.9.0 预算表迁移
supabase-recurrings.sql        v1.10.0 固定支出表 + transactions.recurring_id
public/ocr/                    收据识别模型（自己托管，不走第三方 CDN）
src/
  import/
    pdfTable.js                PDF 表格还原：朝向判定、合并行、切列、处理折行
    tngStatement.js            TnG 对账单规则：日期金额解析、交易类型判定、商户归类
    merchants.js               商户名→分类，对账单和收据截图共用一份
    receipt.js                 收据文字解析：挑金额（避开余额和手续费）、认日期方向商户
    ocr.js                     截图识别：灰度、深色模式反色、放大，模型自托管
  App.jsx                      主界面、底部导航、月份切换
  db.js                        IndexedDB 读写、软删除墓碑、备份导入导出
  supabase.js                  Supabase 客户端（未配置时整体降级为纯本地）
  sync.js                      双向同步引擎：推送脏数据、增量拉取、冲突合并
  useSync.js                   登录状态与同步调度
  categories.js                默认分类与配色槽位
  budget.js                    预算计算：进度、月份进度、可花日均（纯函数）
  recurring.js                 固定支出：扣款日夹紧、已发生判定、可自由支配（纯函数）
  compare.js                   和上月逐分类对比（纯函数）
  utils.js                     金额/日期格式化、汇总统计
  styles.css                   设计令牌与全部样式
  components/
    TransactionSheet.jsx       记一笔 / 编辑弹层
    TransactionList.jsx        按日分组的流水列表
    Stats.jsx                  统计页
    AccountsPage.jsx           资产：总资产、各账户余额、增删改账户
    CalendarView.jsx           日历视图：每日收支 + 当日明细
    DonutChart.jsx             分类占比环形图（手写 SVG）
    TrendChart.jsx             近 6 个月收支柱状图（手写 SVG）
    CategoryManager.jsx        分类增删改
    Settings.jsx               偏好、备份、清空数据
    SyncPanel.jsx              账号与同步状态
    ImportSheet.jsx            对账单导入：预览、逐条确认、去重
    BudgetSettings.jsx         预算上限设置
    BudgetBar.jsx              预算进度条
    RecurringSettings.jsx      固定支出登记与编辑
    RecurringPanel.jsx         本月固定支出面板 + 可自由支配那一行
    ReceiptSheet.jsx           收据截图导入：选来源 → 粘贴或选图 → 核对 → 保存
    CompareSection.jsx         和上月对比
scripts/
  make-icons.py                重新生成各尺寸图标
  smoke-test.mjs               生产构建冒烟测试（含离线验证）
  sync-logic-test.mjs          同步逻辑单元测试（冲突合并、墓碑、脏标记）
  make-sample-statement.py     生成结构相同的测试对账单 PDF（数据全是编的）
  import-test.mjs              对账单导入端到端测试
  budget-test.mjs              预算计算单元测试
  recurring-test.mjs           固定支出与月度对比单元测试
  pad-test.mjs                 数字键盘运算与税费单元测试
  fx-test.mjs                  多货币折算单元测试
  receipt-test.mjs             收据文字解析单元测试
  make-sample-receipts.py      生成测试用收据截图（数据全是编的）
  ocr-test.mjs                 收据 OCR 端到端测试（含深色模式、低分辨率）
```

### 配色说明

图表配色取自一套经过色觉障碍（CVD）分离度校验的固定色序，分类的颜色跟着分类本身走，切换月份不会换色。同屏超过 7 个分类时，尾部自动合并为「其他分类」，避免颜色被迫循环使用。图例同时给出图标、名称、金额，并可展开数据表，所以识别从不只依赖颜色。

---

## 测试

**同步逻辑单元测试**（不联网，几秒跑完）：

```bash
node scripts/sync-logic-test.mjs
```

覆盖冲突合并、软删除墓碑传播、上传中途又编辑、清空数据的传播语义。

**端到端冒烟测试**（含离线验证）：

```bash
npm run build
npx vite preview --port 4173 &
npm i -D playwright && npx playwright install chromium
node scripts/smoke-test.mjs
```

会走一遍记账流程、截图各个页面，并验证断网后仍能打开。

**对账单导入测试**：

```bash
pip install reportlab
python3 scripts/make-sample-statement.py
node scripts/import-test.mjs
```

用一份结构与 TnG 对账单相同的测试 PDF，验证折行合并、页脚过滤、交易类型判定、
按余额变化定方向、商户自动归类、重复导入去重，以及加密 PDF 的密码流程。

测试文件有三个变体，内容相同但排版不同，解析结果必须完全一致：

```bash
python3 scripts/make-sample-statement.py /tmp/tng-rot.pdf    -            rotated
python3 scripts/make-sample-statement.py /tmp/tng-flat.pdf   -            flat
python3 scripts/make-sample-statement.py /tmp/tng-locked.pdf 880506015527 rotated
```

### 为什么要判定页面朝向

真实的 TnG 对账单是把横向表格画在纵向页面上（整体转 90°）。
按坐标直接分组，得到的是「列」而不是「行」——表面上能跑，
实际每一行都是一整列的内容拼在一起，全盘错位且不报错。

解析器会依次尝试三种朝向，选能找到表头**并且**解析出记录的那个。
判据是客观的，不依赖对 PDF 生成器的假设。

> pdf.js 固定在 v4：v6 用了 `Map.getOrInsertComputed` 这类很新的语法，
> 老一些的手机浏览器（尤其 iOS Safari）会直接报错。这个依赖不要随手升级。
