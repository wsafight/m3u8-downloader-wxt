# M3U8 Stream Downloader

[English](./README.md) | 简体中文

浏览器扩展，自动检测网页中的 HLS/M3U8 视频流并下载为本地文件。支持加密流、多清晰度、fMP4、直播录制、批量队列、TS→MP4 重封装、弹窗在线预览。

---

## 功能

### 核心功能

- **三路自动检测**：同时拦截 XHR/Fetch 请求、监听网络响应头、扫描 DOM `<video>` 元素，三路并行确保不遗漏任何流地址
- **下载前在线预览**：点击流列表中的 ▶ 按钮，基于 hls.js 即时在扩展内播放视频流，确认内容正确再下载，省去重复操作
- **AES-128 加密流**：CBC 模式，自动获取并缓存密钥，支持显式 IV 和序列号推导 IV，完全在浏览器内通过 Web Crypto API 解密
- **多清晰度选择**：解析 Master Playlist，按带宽从高到低排序，下载前可手动选择 1080p / 720p / 480p 等任意画质
- **Cookie 自动透传**：下载时自动携带当前页面的 Cookie 与 Referer，无需手动配置即可绕过鉴权校验，适配需要登录的流媒体站点
- **直播流录制**：自动识别直播流（无 `#EXT-X-ENDLIST`），一键切换录制模式，停止后自动合并为 `.ts` 文件保存到本地
- **TS → MP4 重封装**：格式切换开关，基于 mux.js 在浏览器内将 MPEG-TS 重封装为 fragmented MP4，无需 FFmpeg；转换失败时自动回退为 .ts
- **批量下载队列**：在弹窗中将多个流一键加入队列，后台 Service Worker 依次自动处理，无需手动守候每一个任务
- **分片状态网格 & 部分重试**：下载时以点阵实时显示每个分片状态（灰/绿/红），失败后可一键重试失败分片或直接保存已完成部分

### 技术亮点

- **实时速度 & ETA**：4 秒滚动窗口计算瞬时下载速度，动态估算剩余时间，不再盲等
- **分片范围剪切**：双滑块精确拖选起止分片，实时显示时间戳与选中时长，轻松截取任意片段
- **fMP4 & BYTERANGE 支持**：解析 `#EXT-X-MAP` 初始化分片，支持 `#EXT-X-BYTERANGE` 字节范围请求，完整兼容现代 HLS 格式
- **下载历史记录**：自动记录最近 200 条（文件名、大小、分片数、域名），支持单条删除与批量清空
- **错误分级诊断**：403 建议刷新登录、404 提示链接过期、429 建议降低并发、5xx 提示稍后重试，不再面对晦涩错误码
- **低内存合并 & 设置同步**：每 100 段批次合并 Blob 并释放 ArrayBuffer，避免 OOM；并发线程数与输出格式通过 `chrome.storage.sync` 跨会话保存

---

## 技术栈

| 层            | 技术                                          |
| ------------- | --------------------------------------------- |
| 扩展框架      | [WXT](https://wxt.dev) v0.20 + Manifest V3    |
| UI            | Svelte 5（`$state` / `$derived` / `$effect`） |
| 语言          | TypeScript 5.9（strict 模式）                 |
| 构建          | Vite 7（via WXT）                             |
| 包管理 & 测试 | Bun                                           |
| TS→MP4 重封装 | mux.js 6.3                                    |
| HLS 预览播放  | hls.js 1.6                                    |

---

## 开发

### 前置要求

- [Bun](https://bun.sh) ≥ 1.0
- Chrome 109+ 或 Firefox 109+

### 安装依赖

```bash
bun install
```

### 开发模式

```bash
# Chrome（默认）
bun run dev

# Firefox
bun run dev:firefox
```

WXT 会自动打开带有扩展的浏览器，并启用热重载。

### 构建

```bash
bun run build          # Chrome
bun run build:firefox  # Firefox
```

构建产物在 `.output/chrome-mv3/`（Firefox 为 `firefox-mv2/`）。

### 打包发布

```bash
bun run zip          # Chrome .zip
bun run zip:firefox  # Firefox .zip
```

### 运行测试

```bash
bun test
```

---

## 加载扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3/`

---

## 项目结构

```
src/
├── entrypoints/
│   ├── hooks.content.ts          # MAIN world — Hook 页面 XHR/fetch
│   ├── content.ts                # ISOLATED world — DOM 观察 + 消息中继
│   ├── background.ts             # Service Worker — 网络拦截、流管理、队列调度
│   ├── popup/
│   │   ├── App.svelte            # 弹窗主界面（流列表 / 队列 / 历史 三标签）
│   │   ├── QueueTab.svelte       # 下载队列标签页
│   │   └── HistoryTab.svelte     # 下载历史标签页
│   └── download/
│       ├── App.svelte            # 下载页面根组件
│       ├── ActionButtons.svelte  # 操作按钮（开始 / 中止 / 重试）
│       ├── LogTerminal.svelte    # 活动日志终端
│       ├── ProgressDisplay.svelte# 进度条 + 预计时间
│       ├── RecordingStatus.svelte# 直播录制状态
│       ├── SegmentGrid.svelte    # 分片状态点阵
│       └── SegmentRangeSlider.svelte # 双滑块分片范围选择器
└── lib/
    ├── types.ts          # 公共类型定义
    ├── messages.ts       # 跨组件消息类型常量
    ├── settings.ts       # 用户设置持久化（chrome.storage.sync）
    ├── m3u8-parser.ts    # HLS 播放列表解析器
    ├── downloader.ts     # 下载引擎（并发 / 解密 / 合并 / 速度追踪）
    ├── live-recorder.ts  # 直播录制器（轮询 / 去重 / 分块 Blob）
    ├── remux.ts          # MPEG-TS → fragmented MP4 重封装（mux.js）
    ├── queue.ts          # 下载队列操作（chrome.storage.local）
    └── history.ts        # 下载历史 CRUD（chrome.storage.local）
```

---

## 架构说明

### 检测流程

```
页面 XHR/fetch ──► hooks.content.ts（MAIN world）
                          │  CustomEvent "__m3u8_detected__"
                          ▼
                     content.ts（ISOLATED world）──► background.ts
                          │                               │
                DOM <video>/<source>             webRequest 响应头
                                                          │
                                                    更新 badge 计数
```

MAIN world 脚本能访问页面真实的 `window.XMLHttpRequest` 和 `window.fetch`（ISOLATED world 无法做到这一点）。两个 content script 通过 `CustomEvent` 跨 world 通信，background 同时通过 `webRequest` API 兜底捕获所有漏网请求。

### 点播下载流程

```
M3U8 URL
   │
   ├─► 解析 Master Playlist → 选择画质
   │
   ├─► 解析 Media Playlist → 提取分片列表 + 加密信息 + init segment
   │
   ├─► [可选] 双滑块选取 startIndex ~ endIndex 分片范围
   │
   ├─► 并发下载分片（worker pool，AbortController 支持即时取消）
   │       ├─► AES-128 解密（密钥缓存复用）
   │       └─► 实时上报速度样本（4 秒滚动窗口）→ 计算 ETA
   │
   ├─► 批次合并 Blob（每 100 段一批，释放 ArrayBuffer）
   │
   ├─► [可选] TS → fMP4 重封装（mux.js，仅 .ts 格式流且用户开启转换时）
   │
   ├─► chrome.downloads.download() 保存文件
   │
   └─► 写入下载历史（chrome.storage.local）
```

### 直播录制流程

```
直播 M3U8 URL（isEndList=false）
   │
   ├─► 检测到 isEndList=false → 进入录制模式
   │
   ├─► 轮询 Playlist（每 targetDuration/2 秒）
   │       └─► 过滤已见 URL（Set<string> 去重）
   │               └─► 下载新分片 → 追加 pending[]
   │                       └─► 每 100 段 → flush 为 Blob（释放内存）
   │
   ├─► 用户点击停止 → _stopping=true，AbortController.abort()
   │
   └─► saveAs() → 合并所有 Blob → chrome.downloads 保存 .ts
```

### 队列调度流程

```
popup → enqueueItem() → chrome.storage.local
      → sendMessage(ENQUEUE) → background.ts
                                    │
                          processNextQueueItem()
                                    │
                          chrome.tabs.create(download.html?queueId=…)
                                    │
                          download/App.svelte 完成后
                          sendMessage(QUEUE_ITEM_DONE)
                                    │
                          background 继续处理下一条
```

---

## 权限说明

| 权限                      | 用途                                    |
| ------------------------- | --------------------------------------- |
| `webRequest`              | 拦截响应头检测 M3U8 Content-Type        |
| `downloads`               | 调用系统下载管理器保存文件              |
| `storage`                 | 持久化设置、下载历史、下载队列          |
| `tabs`                    | 获取当前标签页 ID，队列调度时创建下载页 |
| `scripting` / `activeTab` | 注入内容脚本                            |
| `<all_urls>`              | 监听所有网站的网络请求                  |

---

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 许可证

MIT
