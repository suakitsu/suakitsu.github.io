---
title: ProxyTunnel：自托管 EdgeTunnel 与 Mihomo 代理池的真实出口探测与端口隔离设计
date: 2026-11-15
slug: proxytunnel
category: 学习笔记
tags: [Go, PowerShell, Cloudflare, 网络工具]
repo: https://github.com/suakitsu/proxytunnel
excerpt: 节点名称写着某个地区不代表真实出口就在哪里。记录 ProxyTunnel 如何结合 Cloudflare EdgeTunnel 数据面、Mihomo 隔离探测端口（:17891）与国家专享端口构建可验证、可回滚的局域网节点池。
---

在日常开发、跨区 API 测试和多设备局域网共享场景中，维护单个代理节点往往很脆弱：候选源里的节点名称可能标着 `US` 或 `JP`，但实际拨号出去的落地 IP 却是另一个地区，甚至早已失效；而在客户端手动导入几十个节点逐个测速，又会让每台手机和电脑都陷入重复配置的泥潭。

[ProxyTunnel](https://github.com/suakitsu/proxytunnel) 的目标很简单：**在一台主机上集中维护一组可验证、可轮换、可复用的节点池，并通过标准局域网端口、Clash YAML 与 v2rayN 订阅分发给所有可信设备。**

## 整体架构：数据面、运行时与控制面分离

ProxyTunnel 没有重复造代理协议的轮子，而是将 Cloudflare 上的 EdgeTunnel 数据面、本机 Mihomo 代理运行时和 Go + PowerShell 运维控制台组合在一起：

```text
Cloudflare Workers / Pages (cmliu/edgetunnel 数据面)
            │
            │ 订阅派生、配置与健康状态
            ▼
Mihomo 主代理池 :7890 ─────────────────────┐
Mihomo 自选代理池 :7891                    │ Controller API
Mihomo 隔离探针 :17891 / :17901+           │
            ▲                              ▼
Windows 任务适配器 ◀──────────── Go 后端 :9191
            ▲                              ▲
            └──────── Web 网关 :9190 ──────┘
```

各层职责划分非常克制：

- **Go 后端（`:9191`，仅监听本地回环）**：负责候选目录分页检索、真实出口探测、历史快照与控制 API；
- **Web 网关与控制台（`:9190`）**：对可信局域网提供仪表盘、自选池构建向导以及 Clash / v2rayN 订阅下载；
- **Mihomo 多实例端口组**：承担实际的流量转发与健康检查。

## 为什么必须用隔离探针（`:17891`）做真实出口验证

很多节点管理工具的“测速”只是做一次 TCP 握手或依赖节点名字里的国家标签。但在 EdgeTunnel + ProxyIP 体系下，**节点标签和真实出口经常不一致**。

如果在主代理端口（`:7890`）上直接切节点探测，会导致正在使用主池的业务请求瞬间断流或出口乱跳。因此，ProxyTunnel 专门拉起了一个**隔离探针实例（`:17891`，Controller `:19091`）**：

1. 候选节点先挂载到隔离探针 `:17891`；
2. Go 后端通过探针发起 Cloudflare Trace 请求，解析真实的**出口 IP、落地国家代码、Cloudflare 机房（Colo）和往返延迟**；
3. 只有连续通过真实出口验证的节点，才会被准入到自选代理池（`:7891`）或分配到国家专用端口（`:17901+`）。

| 端口 | 角色定位 | 故障隔离策略 |
| --- | --- | --- |
| `7890` | Mihomo 主代理池 | 常驻稳定运行，不受后台批量探测与实验分组影响 |
| `7891` | Mihomo 自选代理池 | 供局域网多设备共享；新池构建失败时自动回滚并保留上一版可用配置 |
| `17891` | 隔离探针入口 | 仅用于后台真实出口校验，不对业务暴露 |
| `17901+` | 国家专用端口 | 为连续验证通过的指定国家节点分配独立入口，供固定地区业务调用 |

## 修复上游 EdgeTunnel 的跨请求全局状态污染

在集成上游 `cmliu/edgetunnel`（通过 Git Submodule 固定在可审计的 commit）时，我遇到了一个隐蔽的并发问题：上游代码在处理请求参数与拨号配置时存在模块级全局变量，高并发请求下不同连接可能会互相覆盖拨号目标。

为了既不破坏上游源码仓库、又能保证Worker并发安全，我在 `cloudflare/scripts/build-worker.mjs` 中实现了一套**带唯一锚点校验的构建期补丁**：

- 在构建阶段自动将请求级拨号上下文迁移到 Node/Workers 的 `AsyncLocalStorage` 中，彻底消除跨请求状态污染；
- 移除对远程第三方管理页的依赖，改用仓库内置且不接收 Cloudflare Global API Key 的安全 `/login` 与 `/admin` 页面；
- 如果上游代码更新导致补丁锚点失效，构建直接报错终止，绝不静默退回未修补状态。

## 零复制粘贴的启动体验

以前部署完 Worker 后，用户往往要去 KV 绑定页、环境变量页和管理后台之间来回复制 Namespace ID、UUID 和订阅地址。在 ProxyTunnel 中，整个流程被收敛到了两个脚本：

```powershell
# 1. 首次部署 Cloudflare Worker（自动创建并绑定 KV，只需输入一个 ADMIN 密码）
.\cloudflare\DEPLOY.cmd

# 2. 启动本机代理池与控制台（自动派生订阅并拉起 7890 / 9191 / 9190）
.\START.cmd
```

`ADMIN` 管理密码仅在内存中用于派生凭据，不落盘、不进 Git；所有运行态快照全部隔离在 `.gitignore` 保护的 `var/` 目录下。项目代码与架构文档见 [suakitsu/proxytunnel](https://github.com/suakitsu/proxytunnel)。
