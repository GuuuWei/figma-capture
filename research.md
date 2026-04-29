# Figma Capture — 深度研究报告

## 1. 项目概述

**Figma Capture** 是一个 Chrome 扩展（Manifest V3），作用是将任意网页捕获为 Figma 的剪贴板格式，用户只需点击扩展图标，然后在 Figma 中粘贴即可将网页设计导入 Figma。

它的核心价值不在于捕获本身——那是 Figma 官方 `capture.js` 脚本的功能——而在于**对捕获结果的后处理**：修正 CJK 字体、清理冗余 DOM 节点、扁平化无意义的 wrapper 层级，使最终粘贴到 Figma 的结果更干净、更准确。

- **作者**: Cheng（2025）
- **许可证**: MIT
- **版本**: 1.1

---

## 2. 文件结构与职责

| 文件 | 类型 | 职责 |
|---|---|---|
| `manifest.json` | 配置 | Chrome 扩展清单（MV3），声明权限、background service worker、图标、web-accessible 资源 |
| `background.js` | 核心代码 | 扩展入口：监听图标点击、注入拦截器和 capture.js、触发捕获 |
| `capture.js` | 外部依赖 | Figma 官方的 DOM 序列化脚本（被 .gitignore 忽略，通过 Makefile 下载） |
| `font-map.json` | 配置 | 用户自定义的字体映射表（被 .gitignore 忽略） |
| `font-map.example.json` | 模板 | 字体映射示例文件 |
| `Makefile` | 构建 | 从 Figma 的 MCP 端点下载 `capture.js` |
| `test.html` | 测试 | 用于验证字体修正和 DOM 扁平化效果的中文测试页 |
| `icon16/48/128.png` | 资源 | 扩展图标（灰度 Figma logo + 黑色箭头） |
| `.gitignore` | 配置 | 忽略 `capture.js` 和 `font-map.json` |
| `LICENSE` | 法律 | MIT 许可证 |
| `README.md` | 文档 | 使用说明和原理介绍 |

---

## 3. 工作流程（端到端）

```
用户点击扩展图标
       │
       ▼
 ┌─────────────────────────────────────────────┐
 │  background.js: chrome.action.onClicked     │
 │                                             │
 │  Step 0: 读取 font-map.json                 │
 │          注入 window.__FONT_MAP             │
 │                                             │
 │  Step 1: 注入 installFontInterceptor()      │
 │          → 拦截 navigator.clipboard.write    │
 │          → 拦截 navigator.clipboard.writeText│
 │                                             │
 │  Step 2: 注入 capture.js（Figma 官方脚本）   │
 │                                             │
 │  Step 3: 调用 figma.captureForDesign()      │
 │          参数 { selector: 'body' }           │
 │          → 不传 endpoint → 只复制不发送      │
 └─────────────────────────────────────────────┘
       │
       ▼
 capture.js 遍历 DOM，序列化为 JSON payload，
 调用 navigator.clipboard.write / writeText
       │
       ▼
 ┌─────────────────────────────────────────────┐
 │  拦截器截获 clipboard 写入                   │
 │                                             │
 │  ① 解析 JSON payload（root.nodeType === 1） │
 │  ② 执行 transformPayload(root)：            │
 │     - fixFont()      → 字体修正             │
 │     - cleanupNodes() → 空节点/空白清理       │
 │     - phase3Flatten()→ wrapper 扁平化        │
 │     (cleanup + flatten 循环 3 次)            │
 │  ③ 写入修正后的 payload 到剪贴板             │
 └─────────────────────────────────────────────┘
       │
       ▼
 用户切换到 Figma → Ctrl/Cmd+V 粘贴
```

所有注入均在 `world: 'MAIN'`（页面主世界）中执行，这样才能拦截到页面脚本对 `navigator.clipboard` 的调用。

---

## 4. 核心机制深度分析

### 4.1 剪贴板拦截器

拦截器 monkey-patch 了两个 Clipboard API：

#### `navigator.clipboard.writeText`
- 尝试将文本解析为 JSON
- 如果根节点 `nodeType === 1`（Element），执行 `transformPayload`
- 将转换后的 JSON 写入剪贴板

#### `navigator.clipboard.write`
- 针对 `text/html` 类型的 ClipboardItem
- 从 HTML 的 `data-h2d` 属性中提取 base64 编码的 JSON payload
- payload 被 `<!--(figh2d)` 和 `(/figh2d)-->` 注释标记包裹
- 解码流程：去除注释标记 → base64 解码 → UTF-8 文本 → JSON 解析
- 执行 `transformPayload` 后反向编码写回
- 编码时使用 8192 字节分块的 `String.fromCharCode` 以避免栈溢出

防重复安装：通过 `window.__figmaCaptureInterceptor` 标记。

### 4.2 字体修正（fixFont）

递归遍历序列化的 DOM 树，对每个元素节点执行：

| 场景 | 处理方式 |
|---|---|
| 无 `fontFamily` | 设为 `Noto Sans SC`（防止 Figma 回退到 Times） |
| 已有 PingFang / Noto SC | 跳过 |
| 图标字体（Material/FontAwesome 等） | 保留原字体，如果文本含 CJK 则追加 `, PingFang SC` |
| 含 CJK 文本 + 衬线字体 | 替换为 `Noto Serif SC` |
| 含 CJK 文本 + 非衬线字体 | 替换为 `PingFang SC` |
| 最后一步：font-map 映射 | 将字体名逐个通过 `font-map.json` 映射替换 |

**CJK 检测正则**：`[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]`
覆盖：CJK 统一汉字、CJK 扩展A、平假名、片假名、韩文音节。

**图标字体检测正则**：`/Material|Symbol|Icon|FontAwesome|fa-/i`

**衬线字体判定集合**：Georgia、Times New Roman、Times、Palatino、Palatino Linotype、Garamond、Bookman、Book Antiqua、Cambria、Didot。

**文本收集函数 `collectText`**：递归收集节点及其子节点的所有文本内容（nodeType 3 = 文本节点，nodeType 1 = 元素节点）。

### 4.3 DOM 扁平化（phase3Flatten）

**目标**：消除无视觉贡献的 wrapper 元素（如 `<div><div><span>内容</span></div></div>` → `<span>内容</span>`）。

**可扁平化的条件**（`canFlatten`）：
1. 节点类型为元素（nodeType === 1）
2. 标签属于直通标签集合：DIV、SPAN、SECTION、ARTICLE、MAIN、ASIDE、HEADER、FOOTER、NAV
3. 无装饰性样式（`hasDecoration` 返回 false）
4. 只有一个子节点
5. 如果有 `overflow: hidden/clip`，则要求父子尺寸匹配
6. 子节点为文本（直接提升）或与父元素尺寸近似（4px 容差）

**装饰性检测**（`hasDecoration`）：
- 可见背景色/背景图（排除 transparent/rgba(...,0)）
- 可见边框（排除 0px/none/transparent）
- box-shadow 或 outline（排除 none/0）
- opacity 非 1
- 注意：`borderRadius` 单独存在不算装饰（无背景/边框时不可见）

**提升时的处理**（`promoteChild`）：
- 将 wrapper 的 flex 布局属性（flex、flexGrow、flexShrink、flexBasis、order、alignSelf）转移给子节点
- 子节点保留自己的 `rect`（绝对坐标已正确）
- 不提升有兄弟节点时的文本节点（Figma 会合并相邻文本）

**遍历方向**：自底向上（先递归子节点，再判断自身是否可扁平化）。

### 4.4 空节点清理（cleanupNodes）

三层清理逻辑（递归 + 冒泡）：

1. **纯空白文本节点**：`text.trim()` 为空 → 移除
2. **空元素节点**：无子节点 + 非自渲染标签 + 无装饰 + 尺寸 < 1px → 移除
   - 自渲染标签白名单：IMG、SVG、VIDEO、CANVAS、INPUT、TEXTAREA、SELECT、IFRAME、HR
3. **冒泡移除**：非自渲染、无装饰的容器如果清理后子节点为零 → 返回 null（从父节点中移除）

### 4.5 变换管线（transformPayload）

```javascript
fixFont(root);
for (let i = 0; i < 3; i++) {
  cleanupNodes(root);
  phase3Flatten(root);
}
```

cleanup 和 flatten 循环 3 次的原因：清理可能暴露新的扁平化机会（例如删除一个空兄弟后，wrapper 变成单子节点可以被扁平化），反之亦然。

---

## 5. Figma 官方 capture.js

通过 Makefile 从 `https://mcp.figma.com/mcp/html-to-design/capture.js` 下载。

这是 Figma [HTML to Design](https://www.figma.com/community/plugin/1159123024924461424) 插件的核心脚本，经过混淆压缩（~60KB+），主要功能：

- 遍历页面 DOM 树
- 读取每个元素的计算样式（computed styles）
- 序列化为 Figma 内部格式的 JSON 结构（包含 nodeType、tag、styles、rect、childNodes 等）
- 处理图片、字体、React fiber 元数据等
- 通过 `window.figma.captureForDesign()` 暴露捕获接口
- 调用 `navigator.clipboard.write/writeText` 写入剪贴板

本扩展调用时不传 `endpoint` 参数，因此脚本只执行复制操作，不会向 Figma 服务器发送数据。

---

## 6. 字体映射配置

`font-map.json`（用户自定义，不纳入版本控制）允许将网页上的字体名映射为 Figma 中可用的字体名：

```json
{
  "Times": "Times New Roman",
  "Google Sans": "Google Sans Flex",
  "Google Sans Text": "Google Sans Flex"
}
```

映射发生在所有其他字体修正之后，作为管线的最后一步。对字体名列表中的每个字体独立映射（逗号分隔）。

---

## 7. 扩展配置（manifest.json）

| 字段 | 值 | 用途 |
|---|---|---|
| manifest_version | 3 | Chrome MV3 |
| permissions | `activeTab`, `scripting` | 在当前标签页注入脚本 |
| host_permissions | `<all_urls>` | 需要在任意页面注入脚本 |
| background.service_worker | `background.js` | 扩展后台逻辑 |
| web_accessible_resources | `font-map.json` | 使 font-map.json 可被注入的脚本通过 `chrome.runtime.getURL` 访问 |
| action | 点击图标触发 | 无 popup，直接触发 `onClicked` |

---

## 8. 测试页面（test.html）

一个精心设计的中文测试页面，覆盖了所有核心场景：

| 测试组 | 验证内容 |
|---|---|
| Phase 1 — Mixed CJK/Latin | 中英混排的字体替换（sans-serif → PingFang SC，serif → Noto Serif SC） |
| Phase 2 — Pure CJK | 纯中文/日文/韩文的字体修正 |
| Icons — Material Symbols | 图标字体保留 + CJK fallback 追加 |
| Phase 3 — Nested Wrappers | 多层空 div 扁平化、有样式 div 保留 |
| Control — Pure Latin | 纯英文不被修改 |
| Emoji + CJK | Emoji 与中文混排 |

---

## 9. 构建流程

```makefile
all: capture.js

capture.js:
	curl -o capture.js 'https://mcp.figma.com/mcp/html-to-design/capture.js'

clean:
	rm -f capture.js
```

- `make` → 下载 capture.js
- `make clean` → 删除 capture.js
- capture.js 不在仓库中（.gitignore），每次构建时从 Figma 端点获取最新版

---

## 10. 设计决策与技术亮点

### 10.1 非侵入式拦截
扩展不修改页面 DOM，也不修改 capture.js。它在 capture.js 执行之前安装剪贴板拦截器，在 capture.js 写入剪贴板时拦截并变换 payload。这意味着：
- capture.js 可以随意更新而不影响扩展逻辑
- 页面渲染不受影响
- 所有变换仅作用于 JSON 中间表示

### 10.2 MAIN world 注入
所有脚本注入到 `world: 'MAIN'`（页面主世界），而非扩展的 isolated world。这是必须的，因为：
- capture.js 运行在主世界
- 需要拦截主世界中的 `navigator.clipboard` API
- 需要访问 `window.figma` 对象

### 10.3 多通道变换
cleanup + flatten 执行 3 轮而非 1 轮，因为这两个操作有相互依赖：
- cleanup 移除空节点可能使 wrapper 变成单子节点 → 可扁平化
- flatten 提升子节点后可能产生新的空容器 → 可清理

### 10.4 Base64 编解码的分块处理
HTML 剪贴板格式中的 `data-h2d` 属性使用 base64 编码。编码回写时使用 8192 字节分块的 `String.fromCharCode`，避免对大页面触发 "Maximum call stack size exceeded" 错误。

### 10.5 Flex 属性继承
扁平化 wrapper 时，flex 布局属性（flex、flexGrow 等）会从 wrapper 转移到被提升的子节点，确保在 Figma 中布局不会错乱。

---

## 11. 局限性与潜在风险

1. **Figma 格式依赖**：依赖 Figma 的未公开 HTML-to-Design 剪贴板格式（`figh2d`），该格式可能随时变更
2. **capture.js 端点**：从 `mcp.figma.com` 下载，Figma 可能更改或移除该端点
3. **CJK 覆盖范围**：未覆盖 CJK 扩展 B-G（U+20000-U+3134A）和部分生僻字
4. **字体可用性假设**：假设用户系统安装了 PingFang SC、Noto Sans SC、Noto Serif SC
5. **图标字体检测**：基于名称匹配的启发式方法，可能遗漏自定义图标字体或误判
6. **尺寸容差**：4px 的扁平化容差在大多数情况下合理，但对高精度场景可能导致误扁平化
7. **仅 Chrome**：MV3 manifest，不支持 Firefox 或 Safari

---

## 12. 总结

Figma Capture 是一个精巧的 Chrome 扩展，通过 **剪贴板拦截 + JSON payload 变换** 的方式，在 Figma 官方捕获脚本和剪贴板之间插入一个后处理层。它解决了三个实际痛点：

1. **CJK 字体丢失**：Figma 不识别系统字体 fallback 链，中文会回退到 Times New Roman
2. **DOM 层级臃肿**：现代 Web 框架生成大量无意义 wrapper div，导致 Figma 帧层级过深
3. **空节点噪声**：零尺寸元素和空白文本节点在 Figma 中产生不可见但干扰操作的帧

设计上，它选择了最小侵入的方式——不修改页面、不修改 Figma 脚本、不发送任何数据——只在剪贴板写入的瞬间完成变换。
