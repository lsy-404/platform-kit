# @platform-kit/appearance-check

开发期外观检查套件。用 Chromium 读取 Vue 等应用渲染后的 DOM、计算样式和几何；无需给组件标注内外圆角关系。提供 CLI、Node API 和 Vite 构建警告，Apache-2.0。

## 检查项

编号在参数、JSON、警告和忽略配置中一致；已有编号不复用。

| 编号 | 检查项 | 判定范围 |
| --- | --- | --- |
| AP001 | 文本颜色对比度 | axe 对实际前景和背景的对比度检查 |
| AP002 | hover / focus 可读性 | 自动发现可见控件，检查悬停与键盘 focus 时的文字对比度 |
| AP003 | 同心圆角 | 可见嵌套表面的实际间距与内外圆角，含椭圆、百分比、胶囊形和透明包装层 |
| AP004 | 内容重叠 | 独立可见文字之间的交叠 |
| AP005 | 换行与容器 | 文字裁切、逃出容器、控件标签异常换行；允许显式省略和滚动区域 |
| AP006 | 视觉层级 | 标题比附近正文更弱的字体层级 |
| AP007 | 视觉居中 | 居中图标按钮中 SVG 实际绘制边界的偏移 |
| AP008 | 表面层叠 | 重复包围内容的边框或阴影层 |

AP003–AP008 根据渲染证据推断设计意图，报告是警告。AP007 测量绘制边界中心，不能等同于人眼的知觉中心。颜色检查关注可读性；品牌配色是否合适、内容是否美观不属于确定性判断。

## 安装与参数模式

从本仓库打包的 `platform-kit-appearance-check-0.1.0.tgz` 安装为开发依赖（仓库通过 GitHub Releases 分发包）。需要 Node 24+。

```sh
pnpm add -D /path/to/platform-kit-appearance-check-0.1.0.tgz
pnpm dlx playwright@1.63.0 install chromium
pnpm exec appearance-check --url http://localhost:5173 --viewport 390x844
pnpm exec appearance-check --url http://localhost:5173/settings --checks AP002,AP003 --json
pnpm exec appearance-check --config appearance-check.json --output appearance-report.json --json
pnpm exec appearance-check --list
```

默认检查指定页面的桌面 1280×800 和移动 390×844 视口；每个视口最多检查 40 个控件的 hover / focus。使用 `--max-controls` 修改上限，`--ignore-check AP003` 关闭某项检查，`--executable-path` 指定已安装的 Chromium。CLI 退出码：0 无问题；1 输入错误、执行失败或有覆盖缺口；2 发现问题。`--warn-only` 让报告不改变退出码，输入或启动错误仍返回 1。

配置文件使用 Node API 的 JSON 参数：

```json
{
  "urls": ["http://localhost:5173/settings"],
  "checks": ["AP001", "AP002", "AP003", "AP004", "AP005", "AP006", "AP007", "AP008"],
  "ignores": [
    {"checkId": "AP003", "page": "/settings", "selector": ".brand-card", "reason": "品牌装饰使用独立圆角"},
    {"checkId": "AP002", "page": "/settings", "selector": "#preview", "state": "hover", "reason": "已登记的预览状态问题"}
  ]
}
```

忽略项中的字段同时匹配；未指定的字段不限。`page` 匹配完整 URL、pathname 或 Vue 的 hash 路由，支持 `*`。`selector` 匹配元素及其后代，`state` 为 `default`、`hover`、`focus`。已忽略的问题保留在 JSON 的 `suppressed` 中，包含原因；其他页面和状态仍接受检查。

## Vite 构建警告

支持 Vite 7 和 8。在 `vite.config.ts` 中导入独立工具入口：

```ts
import { defineConfig } from 'vite';
import { appearanceCheck } from '@platform-kit/appearance-check/vite';

export default defineConfig({
  plugins: [appearanceCheck({
    paths: ['', 'settings'],
    checks: ['AP002', 'AP003', 'AP004', 'AP005'],
    ignores: [{checkId: 'AP003', page: '*/settings', selector: '.brand-card', reason: '品牌装饰'}]
  })]
});
```

插件只在应用构建写盘后启动临时本地预览，并打印带编号的警告。它不转换应用源码、不注入运行时、不生成资产或报告文件。报告可通过 `onReport(report)` 回调保存到构建目录以外。检查失败也输出警告；库构建、SSR 或未写盘构建会提示未检查。它不会在 `vite dev` 中执行。

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

报告含 `findings`、`suppressed`、`coverage` 和已扫描的 `pages`。每个 finding 都有 `checkId`、页面、视口、状态、CSS selector、判定可信度和具体 `evidence`。不要把空 findings 当作完整覆盖；同时查看 coverage。

当前范围是指定页面与视口中的可见内容。不会自动遍历路由、滚动全页、点击打开弹窗或提交表单，也不分析伪元素的独立绘制内容。可见 iframe、Shadow DOM、无法计算的几何、axe 不确定结果、超出控件上限及页面脚本错误或 HTTP 失败会列入 coverage。圆角暂不处理旋转、缩放、遮罩和裁剪路径；布局与光学检查也有各自几何限制。测试包含真实 Vue slot/fragment/Teleport，以及启用插件前后所有构建文件 SHA-256 相同的验证。
