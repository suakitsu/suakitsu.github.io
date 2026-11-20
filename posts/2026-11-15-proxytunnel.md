---
title: ProxyTunnel：自托管 EdgeTunnel 与 Mihomo 代理池的真实出口探测与端口隔离设计
date: 2026-11-15
slug: proxytunnel
category: 学习笔记
tags: [Go, PowerShell, Cloudflare, 网络工具]
repo: https://github.com/suakitsu/proxytunnel
excerpt: 深度解析 ProxyTunnel 节点池控制台的架构与实现：如何通过 Mihomo 隔离探针（:17891）核验真实落地 IP 与 Cloudflare Colo，如何用 Fail-Closed 构建补丁将上游 EdgeTunnel 的模块级全局变量迁移至 AsyncLocalStorage，以及如何实现国家专用端口与零停机自动回滚。
---

在多设备局域网开发、跨区接口联调与自动化测试场景里，“维护代理节点”往往是一件非常消耗精力的事情：

1. **节点名称与真实落地出口严重不符**：候选源里的节点名字标着 `JP-Tokyo` 或 `US-West`，但实际通过 ProxyIP 或反代出去的落地 IP 可能是完全不同的国家，甚至早已超时失效；
2. **多台设备各自为战**：如果开发机、测试机、局域网内的笔记本和手机各自导入订阅、各自测速切换，不仅配置繁琐，还会产生成倍的无效探测流量；
3. **探测与切换会打断正在运行的业务**：如果在同一个代理实例上直接切节点测速，正在跑长连接的终端或下载任务会瞬间断流；
4. **上游 Worker 脚本存在并发状态污染与远程依赖隐患**：直接部署未经审计的第三方 Worker 单文件，往往会遇到模块级全局变量在并发请求下互相覆盖、甚至管理页在线拉取外部静态站点并索要 Cloudflare Global API Key 的安全风险。

为了彻底解决这些问题，我构建了 [ProxyTunnel](https://github.com/suakitsu/proxytunnel) —— 一套将 **Cloudflare EdgeTunnel 数据面、Mihomo 多实例代理运行时、Go 监控控制后端（`:9191`）与 Windows 本地运维网关（`:9190`）** 结合在一起的可观测节点池系统。

> 一句话概括 ProxyTunnel 的定位：**它管理的不是某一个静态代理地址，而是一组经过真实出口核验、支持按国家分流、构建失败可自动回滚的局域网共享节点池。**

## 一、四层解耦架构与端口隔离矩阵

ProxyTunnel 将系统严格划分为**云端数据面、本地代理转发层、Go 核心控制层与 Web 网关层**。不同职责的组件运行在各自独立的端口与进程空间中，互不干扰：

```text
Cloudflare Workers / Pages (cmliu/edgetunnel 数据面 · 固定 Submodule + 构建期安全补丁)
            │
            │ 自动派生订阅、配置同步与健康采样
            ▼
┌──────────────────────────────────────────────────────────┐
│ 本机 Mihomo 多实例运行时层                                │
│  ├─ 主代理池     :7890  (Controller :9090)  ── 常驻稳定入口 │
│  ├─ 自选代理池   :7891  (Controller :19092) ── 局域网共享池 │
│  ├─ 隔离探针实例 :17891 (Controller :19091) ── 真实出口探测 │
│  └─ 国家专用端口 :17901+                    ── 单一国家轮转 │
└──────────────────────────────────────────────────────────┘
            ▲                                      ▲
            │ 计划任务与原子切换                    │ Controller REST API
Windows 任务适配器 (PowerShell 7.4+) ◀────── Go 后端 :9191 (仅回环 127.0.0.1)
            ▲                                      ▲
            └──────────── Web 网关 :9190 ──────────┘
                                │
                                ▼
                  可信局域网浏览器 / Clash / v2rayN
```

为什么要在同一台机器上拆出这么多端口？看看下面这张端口职责表就明白了：

| 端口 | 绑定范围建议 | 核心职责与故障隔离设计 |
| --- | --- | --- |
| `9190` | 本机 / 可信局域网 CIDR | Web 控制台 UI、后台构建任务协调、Clash YAML 与 v2rayN Base64 订阅分发 |
| `9191` | **仅 `127.0.0.1`** | Go 核心后端（候选节点目录、真实出口 Trace 解析、历史快照与控制 API） |
| `7890` | 本机 / 按需局域网 | **Mihomo 主代理池**：提供基础兜底代理，绝不参与高风险的批量测速与实验性重构 |
| `7891` | 可信局域网共享 | **Mihomo 自选代理池**：由用户按来源、国家和数量定制；新池构建失败时自动保留上一版可用配置 |
| `17891` | **仅 `127.0.0.1`** | **隔离探针入口**：专门用于在后台逐个挂载候选节点并校验真实出口，完全不影响 `7890` 与 `7891` 的在线连接 |
| `17901+` | 按需开放已启用端口 | **国家专用端口**：把连续多次出口验证稳定的指定国家节点绑定到独立端口，供固定地区业务直接调用 |

## 二、为什么不能相信节点名称：基于 `:17891` 隔离探针的真实出口验证

很多代理面板的“延迟测试”只是向目标发一个 HTTP `204` 请求，看看能不能通，然后直接把节点名字里的 `[US]` 或 `[SG]` 当作国家分类展示出来。但在实际运行中，**“能连通”不代表“出口位置正确”，更不代表“出口稳定”**。

在 `cmd/proxytunnel/main.go` 中，我定义了完整的真实出口探测模型 `NodeStatus` 与 `ProbeNodeResult`：

```go
type NodeStatus struct {
	Name             string  `json:"name"`
	Type             string  `json:"type"`
	CountryCode      string  `json:"country_code"`
	CountryName      string  `json:"country_name"`
	CountrySource    string  `json:"country_source"`
	Alive            bool    `json:"alive"`
	DelayMS          int     `json:"delay_ms"`
	LastCheckAt      string  `json:"last_check_at"`
	EgressReachable  bool    `json:"egress_reachable"`
	EgressIP         string  `json:"egress_ip,omitempty"`
	EgressColo       string  `json:"egress_colo,omitempty"`
	EgressLatencyMS  int64   `json:"egress_latency_ms"`
	EgressCheckedAt  string  `json:"egress_checked_at,omitempty"`
	EgressProbeError string  `json:"egress_probe_error,omitempty"`
	CountryStable    bool    `json:"country_stable"`
	CountrySamples   int     `json:"country_samples"`
	DownloadMbps     float64 `json:"download_mbps"`
	UploadMbps       float64 `json:"upload_mbps"`
	SpeedCheckedAt   string  `json:"speed_checked_at,omitempty"`
}
```

当后台执行候选节点扫描或构建自选池时，探测流程如下：

1. **隔离挂载**：将待测候选节点写入探针专用 Provider，通过探针 Controller（`:19091`）将 `:17891` 切换到目标节点；
2. **Cloudflare Trace 真实采样**：Go 后端通过 `:17891` 代理通道请求 `egress_trace_url`（默认 Cloudflare `/cdn-cgi/trace`），解析返回的真实落地 `ip`、`loc`（ISO 国家代码）与 `colo`（Cloudflare 边缘机房三字码），并计时得出端到端 `EgressLatencyMS`；
3. **连续稳定性判定（`CountryStable`）**：单次采样通过还不够，系统会累计 `CountrySamples`。只有连续多次采样落地国家一致且无抖动的节点，才会被标记为 `country_stable: true`，从而获得进入国家专用端口（`:17901+`）的资格；
4. **原子激活与失败回滚**：`scripts/windows/custom-pool-manager.ps1` 在构建新的 `:7891` 自选池时，会先在临时配置上完成路由验证，只有验证通过才会原子替换线上配置；一旦构建中途失败或被用户取消，立即回滚到上一版快照，在线设备零感知。

## 三、修复上游 EdgeTunnel：Fail-Closed 构建期补丁与 `AsyncLocalStorage` 隔离

ProxyTunnel 的云端数据面基于开源社区广泛使用的 `cmliu/edgetunnel`。为了既能享受上游协议的兼容性，又能保证代码的绝对可审计与安全性，我没有直接把修改后的 `_worker.js` 混在仓库里，而是**将上游作为 Git Submodule 固定在经过审计的 Commit（`92fc6cc4a4cbfdf536394bc9b0397e5948b039f8`）**，并在 Wrangler 构建前通过 `cloudflare/scripts/build-worker.mjs` 执行确定性的**构建期安全补丁**。

在审计上游 `_worker.js` 源码时，我发现了三个必须在生产环境修补的问题：

### 1. 模块级可变全局变量导致的跨请求状态污染

上游代码在模块顶层直接定义了多个可变全局变量：

```javascript
// 上游原始代码中的模块级可变全局变量
let config_JSON, 缓存SOCKS5白名单 = null, 调试日志打印 = false;
let SOCKS5白名单 = ['*tapecontent.net', ...];
let TCP并发拨号数 = 2, 反代并发拨号数 = 1, 预加载竞速拨号 = false;
```

在 Cloudflare Workers 的运行时模型中，**同一个 Isolate 实例会并发处理多个重叠的请求**。如果请求 A 根据自己的环境变量或运营商（如 `cmcc`）修改了模块顶层的 `TCP并发拨号数` 或 `config_JSON`，正在同一 Isolate 中挂起等待 I/O 的请求 B 就会读到被污染的状态！

为此，`build-worker.mjs` 在构建阶段自动注入了 Node.js / Workers 兼容的 `AsyncLocalStorage`，将所有请求级拨号参数收拢进独立的异步上下文存储中：

```javascript
import { AsyncLocalStorage } from "node:async_hooks";
import { serveLocalPage } from "../admin-ui.js";

const 默认SOCKS5白名单 = Object.freeze([
  '*tapecontent.net', '*cloudatacdn.com', '*loadshare.org',
  '*cdn-centaurus.com', 'scholar.google.com'
]);
const 请求状态存储 = new AsyncLocalStorage();
const 默认请求状态 = Object.freeze({
  SOCKS5白名单: 默认SOCKS5白名单,
  调试日志打印: false,
  TCP并发拨号数: 2,
  反代并发拨号数: 1,
  预加载竞速拨号: false,
});

function 当前请求状态() {
  return 请求状态存储.getStore() || 默认请求状态;
}
```

每当 Worker 的 `fetch(request, env, ctx)` 进入时，都会构造当前请求专属的 `请求状态` 对象，并通过 `请求状态存储.run(请求状态, async () => { ... })` 包裹整个生命周期，从根源上消除了跨请求并发污染。

### 2. 恒定时间密码比较（Timing-Safe Comparison）

上游在校验 `/login` 与 `/admin` 的 `authCookie` 和管理员密码时，直接使用了 JavaScript 的 `==` / `===` 字符串比较。我们的构建补丁将其全部替换为基于 Web Crypto API SHA-256 摘要 + `crypto.subtle.timingSafeEqual` 的恒定时间比较函数 `安全比较(左值, 右值)`，防止时序侧信道探测。

### 3. 斩断远程第三方管理页依赖与高危 Cloudflare API Key 收集

上游默认在访问 `/login` 或 `/admin` 时通过 `fetch('https://edt-pages.github.io/admin')` 在线拉取第三方托管页面，且支持在 URL 查询参数或 KV 中传递 Cloudflare `GlobalAPIKey` 来查询账户用量。

这在自托管安全模型下是不可接受的：一旦外部 GitHub Pages 被篡改，或者高权限 `GlobalAPIKey` 进入了 Worker 日志与 KV，整个 Cloudflare 账号都会暴露。因此 `build-worker.mjs` 做了两项硬性裁剪：

- 将所有 `/login`、`/admin`、`/noADMIN`、`/noKV` 页面请求重定向到仓库内置的 `serveLocalPage(...)` 本地受控界面；
- 直接禁用 `/admin/getcloudflareusage` 与 `GlobalAPIKey` 存储逻辑，返回明确的 `410 Gone` 提示，遵循最小权限原则。

更重要的是，`build-worker.mjs` 中的 `replaceOnce(before, after, label)` 采用了 **Fail-Closed（失败即封闭）** 原则：每一个补丁锚点在源码中必须**唯一精确匹配**（`first >= 0 && second < 0`），一旦未来升级 Submodule 时上游代码结构变动导致任何一个锚点失配，构建脚本立即抛出异常终止部署，绝不静默带病上线。

## 四、网关并发调度与“零复制粘贴”的用户引导

在 Windows 本地运行侧，我们也花了很多心思改善工程体验：

1. **有界 Runspace Pool 与心跳监护**：`scripts/windows/monitor-ui-gateway.ps1` 在单个 `HttpListener` 上接收请求后，会将其分发到有界的 PowerShell Runspace 线程池中执行。这样耗时数分钟的后台节点批量探测流绝不会阻塞前端页面的状态轮询与导航切换。同时，`pool-build-worker.ps1` 会持续发布进程 PID 与心跳时间戳；若进程意外崩溃，网关能自动识别失联任务并将其标记为 `interrupted`，不会卡死构建队列。
2. **把三十多个配置项收敛为一个 `ADMIN` 密码**：很多自托管工具要求用户自己去 Cloudflare 控制台创建 KV、复制 Namespace ID、生成 UUID、拼凑 Clash 订阅链接再填回本地 JSON。而在 ProxyTunnel 中：
   - 双击 `cloudflare\DEPLOY.cmd`：只需在掩码输入框输入一个不少于 12 位的 `ADMIN` 密码，Wrangler 会自动在云端创建并绑定 `KV`，密码仅存于仓库外的临时文件并在部署后立即擦除内存 `BSTR`；
   - 双击 `START.cmd`：输入同一个 `ADMIN` 密码，脚本自动登录你自己的 Worker 派生出 `HOST`/`UUID` 与 Clash 订阅，自动生成 Mihomo 配置与随机 Controller 密钥，并在 `7890 / 9090 / 9191 / 9190` 全部就绪后为你打开控制台。

## 五、总结与演进路线

ProxyTunnel 目前处于 `0.1.0-alpha.1` 阶段，默认面向本机与可信局域网（或 Tailscale / ZeroTier 私网）使用。在后续的 `0.2.x` 与 `0.3.x` 路线图中，我计划将目前由 PowerShell 承担的后台任务状态机与进程监护逐步下沉到 Go 服务层，并补齐生产级管理员会话认证、CSRF 防护与 Linux/容器化适配器。

完整源码、架构文档与安全说明均已开源在：[suakitsu/proxytunnel](https://github.com/suakitsu/proxytunnel)。
