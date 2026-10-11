# @platform-kit/appearance-check

开发期外观检查套件。用 Chromium 读取 Vue 等应用渲染后的 DOM、计算样式和几何；无需给组件标注内外圆角关系。提供 CLI、Node API 和 Vite 构建警告，Apache-2.0。

## 检查项

编号在参数、JSON、警告和忽略配置中一致；已有编号不复用。

| 编号 | 检查项 | 维度 | 性质 | 判定范围 | 依据 |
| --- | --- | --- | --- | --- | --- |
| AP001 | 文本颜色对比度 | 可访问性、颜色 | 规范 | axe 对实际前景和背景的对比度检查（1.4.3） | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| AP002 | hover / focus 可读性 | 可访问性、颜色 | 规范 | 自动发现可见控件与复选/单选框的关联标签，检查悬停与键盘 focus 时的文字对比度 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| AP003 | 同心圆角 | 布局 | 建议 | 可见嵌套表面的实际间距与内外圆角，含椭圆、百分比、胶囊形和透明包装层 | https://fluent2.microsoft.design/shapes |
| AP004 | 内容重叠 | 布局、排版 | 建议 | 独立可见文字之间的交叠 | https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html |
| AP005 | 换行与容器 | 布局、排版 | 建议 | 文字裁切、逃出容器、控件标签异常换行；允许显式省略和滚动区域 | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html |
| AP006 | 视觉层级 | 排版 | 建议 | 标题比附近正文更弱，或比其父级标题更醒目的字体层级 | https://m3.material.io/styles/typography/applying-type |
| AP007 | 视觉居中 | 布局 | 建议 | 居中图标按钮中 SVG 实际绘制边界的偏移 | https://fluent2.microsoft.design/iconography |
| AP008 | 表面层叠 | 布局 | 建议 | 重复包围内容的边框或阴影层 | https://fluent2.microsoft.design/elevation |
| AP009 | 链接可辨识 | 可访问性、颜色 | 规范 | 文本中的链接不能仅靠颜色区分（1.4.1） | https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html |
| AP010 | 目标尺寸 | 可访问性、布局 | 规范 | 指针目标不小于 24×24 CSS px 或有足够间距（2.5.8）；不检查 44 px 的 AAA 尺寸 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| AP011 | 允许缩放 | 可访问性 | 规范 | viewport meta 不阻止放大到 200%（1.4.4） | https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html |
| AP012 | 焦点可见 | 可访问性 | 规范 | 键盘焦点到达控件时，周围像素或样式发生可见变化（2.4.7，只判断指示器存在，不评对比度） | https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html |
| AP013 | 焦点未被遮挡 | 可访问性、布局 | 规范 | 获得焦点的控件没有被 fixed / sticky 内容完全盖住（2.4.11） | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |
| AP014 | 重排 | 可访问性、布局 | 规范 | 320 CSS px 宽度下无需横向滚动，内容不被截断（1.4.10） | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html |
| AP015 | 文本间距 | 可访问性、排版 | 规范 | 套用 WCAG 文本间距覆盖后文字不被裁切或重叠（1.4.12） | https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html |
| AP016 | 非文本对比度 | 可访问性、颜色 | 规范 | 输入框等控件边界与纯图标按钮的图形达到 3:1（1.4.11） | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| AP017 | 持续动画 | 可访问性 | 建议 | prefers-reduced-motion: reduce 下仍自动运行超过 5 秒的位移类动画（2.2.2） | https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html |
| AP018 | 标题结构 | 可访问性、排版 | 建议 | 标题级别跳级、空标题（axe best-practice，不当作 1.3.1 失败） | https://dequeuniversity.com/rules/axe/4.13/heading-order |
| AP019 | 颜色漂移 | 颜色 | 建议 | 与更常用颜色差异小于可感知步长的颜色，疑似未令牌化的值 | https://www.w3.org/TR/css-color-4/#color-difference-OK |
| AP020 | 同级节奏 | 布局 | 建议 | 一组相同兄弟元素中某个间距与其余不同 | https://www.nngroup.com/articles/gestalt-proximity/ |
| AP021 | 正文行距 | 排版 | 建议 | 多行正文行距低于 1.2 | https://practicaltypography.com/line-spacing.html |
| AP022 | 行长 | 排版 | 建议 | 每行字符数超过推荐阅读宽度（拉丁文 80，中日韩 40；1.4.8 AAA） | https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html |
| AP023 | 字体加载失败 | 排版 | 建议 | 声明的 Web 字体加载失败并退回备用字体 | https://www.w3.org/TR/css-font-loading-3/#dom-fontface-status |

性质为“规范”的检查对应 WCAG 2.2 A/AA 要求，发现问题使其所在维度失败；“建议”是美学规则、AAA 准则或最佳实践，最多使所在维度给出警告。AP003–AP008 与 AP017–AP023 根据渲染证据推断设计意图。AP007 测量绘制边界中心，不能等同于人眼的知觉中心。颜色检查关注可读性；品牌配色是否合适、内容是否美观不属于确定性判断。工具无法可靠测量时记录覆盖缺口，而不是猜测。不使用 APCA：`apca-w3` 的许可与 Apache-2.0 不兼容。

## 维度结论与退出码

四个维度（可访问性、颜色、布局、排版）各有一个判定：`fail`（有规范问题）、`warn`（仅有建议问题）、`incomplete`（未发现问题但有未能检查的区域）、`pass`、`not-run`（启用的检查不覆盖该维度）。判定不做平均，也不打分。总判定取最差的一行。JSON 报告的顶层依次是 `verdict`、`summary`（固定四行，含 `conclusion`、`counts`、`byCheck`、`top`、`notes`），然后是 `findings` 等。同一问题在不同视口或主题下只计一次。

覆盖缺口分三级：`check`（带检查编号，影响对应维度）、`blocking`（页面无法检查：打开失败、主文档 HTTP 错误、扫描异常、样式表加载失败）、`info`（其他资源错误、网络未静止、页面脚本错误、iframe 与 Shadow DOM）。`info` 不改变判定。

| 退出码 | 条件 |
| --- | --- |
| 1 | 输入或启动错误 |
| 2 | 总判定为 `fail`；使用 `--fail-on warn` 时任一维度为 `warn` |
| 1 | 任一维度为 `incomplete`，或有 `blocking` 缺口 |
| 0 | 其他情况；默认仅有建议问题或 `info` 缺口时为 0 |

`--fail-on fail|warn` 默认 `fail`。`--warn-only` 除输入或启动错误外始终返回 0。

## 度量备注

报告在每个主题的首个视口采集设计度量（调色板、字号、字体、字重、间距网格），写入 `metrics`，并把明显的观察放入对应维度的 `notes`，例如色相族数量、深色主题下的纯黑表面、字号种类、间距不符合 2/4/8 px 网格。备注只是观察，从不产生 finding，也不改变判定。

## 安装与参数模式

从本仓库打包的 `platform-kit-appearance-check-0.1.1.tgz` 安装为开发依赖（仓库通过 GitHub Releases 分发包）。需要 Node 24+。

```sh
pnpm add -D /path/to/platform-kit-appearance-check-0.1.1.tgz
pnpm dlx playwright@1.63.0 install chromium
pnpm exec appearance-check --url http://localhost:5173 --viewport 390x844
pnpm exec appearance-check --url http://localhost:5173/settings --checks AP002,AP003 --color-scheme light --color-scheme dark --json
pnpm exec appearance-check --config appearance-check.json --output appearance-report.json --json
pnpm exec appearance-check --list
```

默认以浅色主题检查指定页面的桌面 1280×800 和移动 390×844 视口；重复传入 `--color-scheme light --color-scheme dark` 检查两种主题。每个视口最多检查 40 个控件的 hover / focus。使用 `--max-controls` 修改上限，`--ignore-check AP003` 关闭某项检查，`--executable-path` 指定已安装的 Chromium。退出码见上节；`--fail-on warn` 让建议问题也返回 2，`--warn-only` 让报告不改变退出码，输入或启动错误仍返回 1。

配置文件使用 Node API 的 JSON 参数：

```json
{
  "urls": ["http://localhost:5173/settings"],
  "colorSchemes": ["light", "dark"],
  "checks": ["AP001", "AP002", "AP003", "AP012", "AP014", "AP016"],
  "ignores": [
    {"checkId": "AP003", "page": "/settings", "selector": ".brand-card", "reason": "品牌装饰使用独立圆角"},
    {"checkId": "AP002", "page": "/settings", "selector": "#preview", "state": "hover", "colorScheme": "dark", "reason": "已登记的深色预览状态问题"}
  ]
}
```

忽略项中的字段同时匹配；未指定的字段不限。`page` 匹配完整 URL、pathname 或 Vue 的 hash 路由，支持 `*`。`selector` 匹配元素及其后代，`state` 为 `default`、`hover`、`focus`，`colorScheme` 为 `light` 或 `dark`。已忽略的问题保留在 JSON 的 `suppressed` 中，包含原因；其他页面和状态仍接受检查。

## Vite 构建警告

支持 Vite 7 和 8。在 `vite.config.ts` 中导入独立工具入口：

```ts
import { defineConfig } from 'vite';
import { appearanceCheck } from '@platform-kit/appearance-check/vite';

export default defineConfig({
  plugins: [appearanceCheck({
    paths: ['', 'settings'],
    checks: ['AP002', 'AP003', 'AP004', 'AP005'],
    colorSchemes: ['light', 'dark'],
    ignores: [{checkId: 'AP003', page: '*/settings', selector: '.brand-card', reason: '品牌装饰'}]
  })]
});
```

插件只在应用构建写盘后启动临时本地预览，并在判定为 `fail`、`warn`、`incomplete` 或有 `info` 缺口时打印报告；它从不使该构建失败。它不转换应用源码、不注入运行时、不生成资产或报告文件。报告可通过 `onReport(report)` 回调保存到构建目录以外。库构建、SSR 或未写盘构建会提示未检查。它不会在 `vite dev` 中执行。

`paths` 是相对于 Vite base 的页面路径；默认首页。需要登录、后端或数据的页面，应先准备可运行的环境，再使用 CLI 检查。构建预览不自动登录或启动后端。

## Node API 与报告

```ts
import { auditAppearance } from '@platform-kit/appearance-check';
const report = await auditAppearance({
  urls: ['http://localhost:5173'],
  checks: ['AP003'],
  viewports: [{width: 1280, height: 800}]
});
```

报告含 `verdict`、`summary`、`findings`、`suppressed`、`coverage`、已扫描的 `pages`（`kind` 为 `scan`、`reflow` 或 `motion`）和 `metrics`。每个 finding 都有 `checkId`、页面、视口、`colorScheme`、状态、CSS selector、判定可信度和具体 `evidence`；`pages`、`coverage` 和 `suppressed` 同样保留主题。不要把空 findings 当作完整覆盖；同时查看 coverage。`colorSchemes` 不能是空列表。主题参数模拟 `prefers-color-scheme`；固定主题或由账户设置控制的页面需由宿主切换到相应主题。

当前范围是指定页面与视口中的可见内容。不会自动遍历路由、滚动全页、点击打开弹窗或提交表单，也不分析伪元素的独立绘制内容。可见 iframe、Shadow DOM、无法计算的几何、axe 不确定结果、超出控件上限及页面脚本错误或 HTTP 失败会列入 coverage。圆角暂不处理旋转、缩放、遮罩和裁剪路径；布局与光学检查也有各自几何限制。测试包含真实 Vue slot/fragment/Teleport，以及启用插件前后所有构建文件 SHA-256 相同的验证。

### 已知限制

- 绘制背景来自 `elementsFromPoint` 的层叠顺序；`pointer-events: none` 的绘制层不可见，其下的颜色可能被误判。
- 由 `requestAnimationFrame` 驱动的动画不在 AP017 的检测范围内。
- 焦点检查（AP002、AP012、AP013）只取一开始就位于视口内的控件。
- 自带横向滚动容器的内容不算 AP014 的重排问题；图片、表格、媒体、代码等二维内容的溢出记为缺口，需人工确认。
- 文本输入框仅靠插入符指示焦点时，AP012 记为缺口，不判定。
- 不使用 APCA，原因见检查项一节。

## 在仓库中构建

```sh
pnpm install --frozen-lockfile
pnpm --filter @platform-kit/appearance-check run typecheck
pnpm --filter @platform-kit/appearance-check run build
pnpm exec playwright install chromium
pnpm run test:appearance
```

完整公开归档使用仓库根目录的 `pnpm run build`、`pnpm run pack:release`，然后执行 `node --test test/appearance-consumer.mjs` 验证独立安装、CLI、类型声明和 Vite 8 消费。
