# Findings

- 公共 ModelAuthDialog 当前直接使用 `toFixed(1)` 展示窗口百分比。
- IRIS 自有 ProviderUsagePanel 当前使用最多 4 位小数；宿主本次会改为默认 2 位。
- 百分比精度属于展示层配置，不应污染 Usage provider 返回的原始数值或公共校验。
