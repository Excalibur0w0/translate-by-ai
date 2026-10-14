# translate-by-ai

一个 Chrome 插件：在网页上右键「用 AI 翻译」，调用**你自己配置的大模型**（默认 OpenRouter 上的 `deepseek/deepseek-v4.1-flash`），译文**追加在原文下方**，不替换原文。

## 功能

- **划词翻译**：选中文字 → 右键「用 AI 翻译「…」」→ 译文出现在选区所在段落的下方。
- **整页双语翻译**：在页面空白处右键「用 AI 翻译此页面」→ 每个段落下方插入译文；**再点一次恢复原文**。
  - 段落滚动到视口附近才翻译，长页面不会一次性消耗大量 token。
  - 页面后续动态加载的内容也会被翻译。
  - 跳过 `<pre>`、`<code>`、输入框、`translate="no"` / `.notranslate`，以及已经是目标语言的段落。
- 译文流式显示；失败时就地显示错误，点击可重试。
- 支持任意 **OpenAI 兼容接口**（OpenRouter、DeepSeek 官方、本地 Ollama 等）。API Key 只保存在本机 `chrome.storage.local`，请求由扩展后台发出，网页拿不到。

## 目录结构（pnpm monorepo）

```
packages/core        与浏览器无关的翻译核心：OpenAI 兼容流式客户端、SSE 解析、prompt、服务商预设、语言列表
apps/extension       Chrome MV3 插件
  src/background     service worker：右键菜单、按需注入脚本、调用模型（流式经 Port 回传）
  src/content        注入网页的脚本：切分段落、插入译文
  src/options        设置页
  static             manifest.json、options.html/css（构建时原样拷贝）
```

## 开始使用

```bash
pnpm install
pnpm build          # 产物在 apps/extension/dist
```

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 「加载已解压的扩展程序」，选择 `apps/extension/dist`。
3. 点击工具栏上的扩展图标打开设置页，填入 OpenRouter API Key（[获取](https://openrouter.ai/keys)），点「测试翻译」确认可用后保存。
4. 在任意网页右键即可使用。

> 第一次右键时如果还没配置 Key，会自动打开设置页。

## 配置说明

| 项 | 说明 |
| --- | --- |
| 服务商 | 预设会自动填好 API 地址、模型和额外参数；选「自定义」可接入任意 OpenAI 兼容接口 |
| API 地址 | base URL，实际请求 `{API 地址}/chat/completions`；也可以直接填完整的 `.../chat/completions` |
| 模型 | 例如 `deepseek/deepseek-v4.1-flash` |
| 额外请求参数 | 合并进请求体的 JSON。OpenRouter 预设为 `{"reasoning":{"enabled":false}}`——该模型默认开启推理，翻译用不上，关掉更快更省 |

使用 OpenRouter 以外的域名时，保存时浏览器会请求访问该域名的权限（`optional_host_permissions`），同意即可。

## 开发

```bash
pnpm dev            # esbuild watch，改完代码后在 chrome://extensions 点刷新
pnpm test           # core 的单元测试（vitest）
pnpm typecheck
```

- 新增服务商预设：编辑 `packages/core/src/providers.ts`。
- 新增目标语言：编辑 `packages/core/src/languages.ts`。
- 译文样式：`apps/extension/src/content/dom.ts` 里的 `CSS`。

## 权限说明

- `contextMenus`：右键菜单。
- `activeTab` + `scripting`：只有在你点击右键菜单时才向当前页注入脚本，平时不读取任何网页。
- `storage`：保存设置。
- `https://openrouter.ai/*`：调用 OpenRouter；其它服务商的域名按需申请。
