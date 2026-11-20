---
title: 从 SuaCanvas 到 PicPilot：AI 电商创作工作台从 Spring Boot 到 Go 的架构演进
date: 2026-11-18
slug: suacanvas-to-picpilot
category: 项目记录
tags: [Go, Java, Next.js, 架构重构, AI创作]
repo: https://github.com/suakitsu/picpilot-platform
excerpt: 完整复盘 AI 电商商品套图与自由画布工作台的三代演进：从 Java/Spring Boot 全家桶（SuaCanvas）出发，如何重构为高内聚的 Go 核心，实现多厂商熔断路由、Local Worker 租约协议、原生 libvips HEIC 归一化与四重密钥隔离，并拆分出平台版（picpilot-platform）与个人版（picpilot-personal）。
---

在我的 GitHub 主页上，有三个围绕“**AI 电商商品套图生成与无限画布（Infinite Canvas）**”展开的仓库：[suacanvas](https://github.com/suakitsu/suacanvas)（素画）、[picpilot-platform](https://github.com/suakitsu/picpilot-platform) 与 [picpilot-personal](https://github.com/suakitsu/picpilot-personal)。

不少朋友看到这三个仓库会好奇：为什么同一个业务方向会有 Java 和 Go 两套后端实现，而且 Go 版本还专门拆成了 `platform` 与 `personal` 两个独立仓库？这篇文章就来完整复盘这套系统从初代重型架构到 Go 双版本解耦的演进脉络，以及我们在**防重复扣费路由熔断、Local Worker 远程算力租约、原生 HEIF 图像安全归一化、四重加密密钥隔离与开源许可证边界**上的工程设计。

## 一、业务场景：为什么电商商品套图不是简单的“文生图抽卡”？

普通文生图工具往往是一个 Prompt 输入框配一个历史九宫格。但在真实的电商视觉创作（Listing 主图、A+ 页面、场景图、卖点拆解图、商品短视频）中，工作流要复杂得多：

1. **多模态参考与主体锁定**：商家上传一张手机实拍图（很多时候还是 iPhone 直接导出的 `.HEIC` 格式）和商品参数文档，要求产出一整套光影协调、商品外观不变形的套图；
2. **多轮 Agent 规划与 Skill 编排**：在调用昂贵的图像/视频模型前，往往需要先通过对话 Agent 拆解视觉方案、翻译多语种卖点文案，再按确定的分镜参数批量下发生成；
3. **同源挂载的双画布精修（`/canvas/nova/` 与 `/canvas/infinite/`）**：生成的素材需要直接进入内置的 **Nova Image Studio** 或 **Infinite Canvas（无限画布）** 进行节点连线、图层排版、局部重绘与高清无裁剪导出。

```text
[ 商品实拍参考图 (JPEG/PNG/WebP/HEIC) + 卖点参数 ]
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│ 1. 接入与安全归一化层                                     │
│    libvips/libheif 无 Shell 调用 ──▶ 8 向 Exif 旋转校正   │
│    剥离隐私元数据 ──▶ 私有资产卷 (/data/assets 或 S3)      │
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│ 2. Go 核心调度与多协议 Provider 路由层 (core/)            │
│    PostgreSQL 全局队列原子认领 ──▶ 协议族适配与熔断器保护  │
│    支持云端 API / 本机网关 (:8888) / Local Worker 租约长轮询│
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│ 3. 同源双画布工作台 (/canvas/nova/ & /canvas/infinite/)   │
│    严守 CSP (拒绝 unsafe-eval) ──▶ 图层编辑与套图成片导出   │
└──────────────────────────────────────────────────────────┘
```

## 二、初代架构（SuaCanvas）：Java / Spring Boot 体系下的深水区探索

在第一代项目 [suacanvas](https://github.com/suakitsu/suacanvas) 中，我们采用了标准的企业级 Java 技术栈（Spring Boot 3、Spring Security + Session JDBC、MyBatis-Plus、PostgreSQL/MySQL、Redis、MinIO，配合前端创作工作台与管理后台）。

在 Java 版阶段，我们已经确立了几条一直沿用到今天的核心安全与计费不变量：

- **双轴 Agent 权限隔离（`full` vs. `plan`）**：将工具访问级别分为 `full`（允许调用生图/创作工具）与 `plan`（仅允许文字对话与 Skill 读取，拦截器层直接阻断付费生图调用），并且严格限制子 Agent 的派发深度与并发上限（每轮最多 3 个子 Agent，子 Agent 禁止继续向下递归派发或直接生图）；
- **SSE 游标断线对账**：所有生成事件与流式 Token 均持久化并分配递增游标，前端标签页切到后台时暂停订阅，切回时先携带游标重连、再做列表状态对账；
- **重启防重放保护（Anti-Replay Billing Protection）**：当服务端重启时，队列中未开始的 `QUEUED` 任务继续执行，但重启瞬间正处于 `RUNNING` 状态的任务会被强制标记为 `INTERRUPTED`——**绝不自动重放任何可能已经在上游供应商侧产生扣费的生成请求**。

## 三、为什么要迁移到 Go，并拆成 `platform` 与 `personal` 两个仓库？

随着项目推进，两个现实矛盾越来越突出：

1. **部署密度与冷启动开销**：整套 Java + 多中间件栈在单机自托管场景下内存基线偏高；而用 Go 重写业务、任务队列与存储核心（`core/`）后，编译产物收敛为单一静态二进制，冷启动变为毫秒级，容器镜像体积与内存占用大幅下降。
2. **“多用户商业运营”与“个人自托管工作台”的边界冲突**：
   - 团队或平台运营者需要完整的**用户注册、Turnstile 验证码、GitHub OAuth、积分/算力账本、充值订单、支付回调验签、风控限流以及独立的 `:8081` 管理员后台**；
   - 而个人创作者只想在自己的电脑或 NAS 上用 Docker 跑起一个纯净的创作台（`:8080`），直接填上自己的 OpenAI / Gemini API Key 或连上本机 `http://127.0.0.1:8888/v1`（容器内通过 `host.docker.internal`）代理网关开始画图，**完全不需要平台计费、充值商城和管理员后台**。

为了不在一套前端和路由里塞满难以维护的判断分支，我们在 Go 重构时确立了 **“同源 `core/` 模块 + 双独立发行仓库”** 的架构：

| 对比维度 | `suacanvas`（Java 初代版） | `picpilot-platform`（Go 平台版） | `picpilot-personal`（Go 个人版） |
| --- | --- | --- | --- |
| **核心定位** | 企业/团队内部 AIGC 工作台 | 多租户运营、积分充值、风控与管理后台 | 个人自托管 AI 创作空间与自由画布 |
| **后端与数据库** | Java 17/21 + Spring Boot 3 | Go (`core/`) + 私有 PostgreSQL | Go (`core/`) + 私有 PostgreSQL |
| **前端拓扑** | 用户端 + 运营管理端 | `:8080` 用户站 + `:8081` 运营后台 + 双画布 | `:8080` 纯净个人工作台 + 双画布（无管理端依赖） |
| **Provider 密钥归属** | 服务端全局配置 | 管理员统一配置与动态权重路由 | 登录用户个人级加密 Provider 配置，严格隔离 |
| **计费与风控模块** | 调用账本与分币种成本估算 | 完整积分/充值/退款/风控/运营报表 | **物理移除**，零计费负担 |

两个 Go 仓库都内置了经过版本锁定的 `core/` 快照（通过本地 Go Module Replace 引用），克隆任意一个仓库即可离线独立构建，互不耦合。

## 四、PicPilot 核心层的五个硬核工程设计

在把后端沉淀到 Go `core/` 模块的过程中，我们重点打磨了以下五个关乎生产稳定性与安全边界的子系统：

### 1. 拒绝盲目重试的 Provider 路由与分级熔断器（Circuit Breaker）

很多对接大模型 API 的网关喜欢把“超时自动重试 + 自动切备用渠道”当作卖点。但在付费图像与视频生成场景下，**网络超时（Ambiguous Network Failure）并不代表上游没有收到请求**——如果上游其实已经开始渲染并扣费，网关却因为等待超时盲目重发一次 POST，或者自动切到另一个付费 Provider 再发一次，就会直接造成**双倍甚至多倍扣费**。

因此，PicPilot 的 HTTP 适配器严格遵守两条铁律：

- **提交状态不明时绝不盲目重发付费 POST**，也不会仅仅因为等待超时就自动把任务转投给另一个付费渠道；
- **跨进程 PostgreSQL 并发协调与分级熔断**：Provider 的并发水位在 PostgreSQL 层全局协调（而非仅在单个 Go 进程内存中计数），并内置可配置的分级熔断冷却窗口：

| 故障类型 | 默认触发阈值 (`failure_threshold`) | 默认熔断冷却时长 | 设计原因 |
| --- | --- | --- | --- |
| **鉴权/密钥失效 (`auth_seconds`)** | 1 次合格故障 | `1800 秒` (30 分钟) | API Key 过期或余额耗尽短时间内不会自愈，避免高频无效撞击 |
| **图像/视频瞬时故障 (`transient_seconds`)** | 1~20 次可配 | `600 秒` (10 分钟) | 生图/视频上游恢复较慢，拉长冷却期保护队列 |
| **文本模型瞬时故障** | 1~20 次可配 | `120 秒` (2 分钟) | 文本接口恢复快，短冷却后即可重新探测恢复 |

同时，客户端参数校验失败（4xx Validation Rejection）或用户主动取消任务，**绝不会被误判为上游渠道故障**，不会污染熔断器计数。

### 2. Local Worker Protocol v1：不暴露本地密钥的远程算力租约

不少开发者在本地工作站或内网机器上跑了 `Sub2API`、`CLIProxyAPI` 或私有推理服务，希望挂载到云端部署的 PicPilot 上使用，但又**不想把内网机器的端口暴露到公网，更不想把本地 OAuth 凭证或 API Key 上传到云端服务器**。

为此，PicPilot 设计了基于长轮询与短期租约的 **Local Worker Protocol v1**：

1. 管理员在后台生成一次性显示的 Worker Token（数据库仅存储加 Pepper 后的哈希值）；
2. 本地 Worker 主动向云端 HTTPS 发起心跳与长轮询认领任务，**云端服务器完全不需要知道 Worker 本地的推理 URL 或本地 Key**；
3. 每个被认领的任务受 `PICPILOT_WORKER_LEASE_GRACE_SECONDS`（默认 15 秒租约宽限期）与 `PICPILOT_WORKER_INPUT_TTL_SECONDS`（默认 300 秒输入有效期）保护，支持多实例租约抢占与断线安全回收。

### 3. 四重独立加密密钥与零默认密码（`instance-secrets.json`）

为了杜绝“弱默认密码（如 `admin/123456`）”导致的公网沦陷，PicPilot 新安装实例**没有任何默认账号或默认密码**，且默认关闭公开注册与支付通道。

首次启动通过一次性命令行令牌完成所有者初始化：

```powershell
# 1. 生成随机初始化环境 (.env) 并构建启动容器
./scripts/init.ps1
docker compose up -d --build

# 2. 在容器内签发一次性管理员初始化令牌
docker compose exec api /picpilot --setup-token
```

同时，系统在数据卷的 `instance-secrets.json` 中自动生成并持久化 **4 把相互独立的 32 字节（256-bit）随机密钥**（URL-safe Base64 编码）：

- `PICPILOT_AUTH_KEY`：会话与身份认证签名；
- `PICPILOT_ENCRYPTION_KEY`：数据库中 Provider API Key 的落盘加密（API 响应永远只返回“是否已配置密钥”的布尔状态，绝不回传明文）；
- `PICPILOT_WORKER_TOKEN_PEPPER`：Local Worker 令牌高熵哈希加盐；
- `PICPILOT_WORKER_SIGNING_SECRET`：内部短期资源链接签名。

### 4. 原生 `libvips` / `libheif` 图像安全归一化（无 Shell 调用）

电商用户经常直接上传手机拍摄的 `.HEIC` / `.HEIF` 原图。在服务端处理图像格式转换时，最危险的做法是用字符串拼接调用 `sh -c "convert ..."`，极易引入命令注入漏洞。

在 PicPilot 的 API 容器镜像中，我们集成了原生 `libvips` 与 `libheif` 工具链，并通过 `PICPILOT_HEIF_ENABLED=true` 启用受控处理：

- Go 后端**仅通过受信任的绝对路径直接调用二进制（不经过任何 Shell 解释器）**；
- 强制校验图像像素尺寸上限与执行超时；
- **完整处理全部 8 种 Exif 方向（Orientation）旋转校正**，自动剥离相机 GPS 等敏感元数据，并统一归一化为安全的 JPEG / PNG / WebP 策略存入私有 `/data/assets` 卷（API 永不暴露底层物理文件路径）。

### 5. 同源双画布嵌入与严格的 CSP 边界

无论是 **Nova Image Studio**（`/canvas/nova/`）还是 **Infinite Canvas**（`/canvas/infinite/`），都直接由仓库内源码可复现地构建，并挂载在用户主站同一 Origin 下提供服务：

- 两个画布**不需要单独配置域名、不需要向前端下发任何模型 API Key，也不需要额外部署 Node 业务后端或 Python 进程**，所有业务请求统一收口至 Go 后端；
- 在嵌入画布时，严格隔离并禁用可执行插件代码，**绝不为了图省事而在 Content-Security-Policy (CSP) 中放开 `unsafe-eval`**。

## 五、开源许可证边界与总结

在开源合规方面，PicPilot 自有原创代码（Go `core/`、API 服务与主界面）均采用宽松的 **[MIT 许可证](https://github.com/suakitsu/picpilot-platform/blob/main/LICENSE)**；而内置集成的 Nova 数据与两个画布项目保留上游的 **AGPL-3.0 许可证**（包含画布的组合发行版按 AGPL-3.0 发布，详见仓库 `LICENSING.md`）。

从 [suacanvas](https://github.com/suakitsu/suacanvas) 到 [picpilot-platform](https://github.com/suakitsu/picpilot-platform) 与 [picpilot-personal](https://github.com/suakitsu/picpilot-personal)，这套系统经历了完整的单元测试、23/24 项 HTTP 冒烟测试、89 项 Nova 画布测试、PostgreSQL 备份恢复校验与 390px 移动端无溢出验收。希望这次从 Spring Boot 到 Go 的架构演进与拆分思路，能给正在构建 AI 创作工具的你带来一些参考。
