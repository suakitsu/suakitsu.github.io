---
title: 从 SuaCanvas 到 PicPilot：AI 电商创作工作台从 Spring Boot 到 Go 的架构演进
date: 2026-11-18
slug: suacanvas-to-picpilot
category: 项目记录
tags: [Go, Java, Next.js, 架构重构, AI创作]
repo: https://github.com/suakitsu/picpilot-platform
excerpt: 复盘 AI 电商商品套图与自由画布工作台的演进过程：为什么从 Java 17 + Spring Boot 3 迁移至 Go，以及如何基于同一套 core 核心拆分出多用户平台版（platform）与个人轻量版（personal）。
---

在我的 GitHub 仓库里，有三个名字和定位看起来一脉相承的项目：[suacanvas](https://github.com/suakitsu/suacanvas)（素画）、[picpilot-platform](https://github.com/suakitsu/picpilot-platform) 与 [picpilot-personal](https://github.com/suakitsu/picpilot-personal)。它们并不是重复造轮子，而是同一个 AI 电商创作工作台在不同阶段的架构演进。

## 起点：SuaCanvas（素画）要解决什么问题

电商场景下的图片创作和纯艺术抽卡不同：商家上传一张商品白底图或实拍参考图后，需要的是一整套风格统一、商品主体不变形的**主图、场景图、卖点图、细节图乃至商品短视频**，并且往往要在生成后进入无限画布（Infinite Canvas）里做局部微调与排版。

第一版 [suacanvas](https://github.com/suakitsu/suacanvas) 采用了我当时最熟悉的典型企业级技术栈：

- **后端**：Java 17 + Spring Boot 3 + MyBatis-Plus + PostgreSQL + Redis + MinIO/S3
- **前端**：Next.js 14（用户创作台 `openImage-ts` + 运营后台 `openImage-admin-ts`）
- **画布与扩展**：集成 `canvas-lab` 自由画布及桌面/移动端客户端

这套架构功能非常完整，但随着自部署需求的增加，痛点也逐渐暴露出来。

## 为什么要从 Spring Boot 重构到 Go

当我想在自己的轻量服务器或本地开发机上随时拉起一整套工作台时，Java 全家桶的启动内存开销、JVM 预热时间以及多组件容器编排显得有些笨重。尤其是对于**“只想自己连上 API Key 跑一个私人创作工作台”**的个人开发者来说，为了画几张图还要跑一套完整的计费、订单、风控和管理后台，负担太重了。

因此，在重构为 **PicPilot** 时，我做了两个核心架构决策：

1. **后端全面迁移至 Go**：将任务调度、模型厂商路由（Provider Routing）、对象存储适配与密钥加密存储重写为高内聚的 Go `core/` 模块，编译为单一静态二进制，内存占用骤降且启动几乎是毫秒级。
2. **同源核心，双版本拆分（Platform vs. Personal）**：不再用一个庞大仓库硬塞所有模式，而是拆分为多用户平台版与个人自部署版。

| 维度 | `suacanvas`（初代） | `picpilot-platform`（平台版） | `picpilot-personal`（个人版） |
| --- | --- | --- | --- |
| **后端技术栈** | Java 17 / Spring Boot 3 | Go + PostgreSQL | Go（轻量自包含） |
| **前端界面** | Next.js 用户端 + 管理后台 | `:8080` 创作台 + `:8081` 运营后台 | 纯净个人创作台 + 自由画布 |
| **模型接入** | 平台统一网关与计费 | 多厂商动态路由、算力点数、充值风控 | 直连自有 API Key 或本地 `127.0.0.1:8888/v1` |
| **适用人群** | 团队内部 / 私有化部署 | 多用户 SaaS / 团队共享运营 | 个人创作者 / 本地开箱即用 |

## 密钥安全与开源协议边界设计

在重构过程中，我还顺手解决了两个工程细节：

### 1. 实例级加密密钥存储
在 `picpilot-platform` 中，模型厂商的 API Key 不会明文散落在环境变量或普通数据库字段里，而是通过实例级加密写入受保护的 `instance-secrets.json`，配合后台动态增删渠道与权重路由。

### 2. MIT 与 AGPL-3.0 的清晰边界
PicPilot 的主工程代码（后端 `core/`、主控前端 `web/`）采用宽松的 **MIT 许可证**；而可选集成的 `canvas-lab/`（基于 Nova Image Studio 与无限画布的深度改造）涉及 **AGPL-3.0** 组件。

```text
picpilot-platform/
├── cmd/picpilot/           # Go 主程序入口（MIT）
├── core/                   # 生成任务、厂商路由、存储与计费核心（MIT）
├── web/                    # Next.js 创作工作台与管理端（MIT）
├── canvas-lab/             # 可选自由画布扩展模块（AGPL-3.0）
└── LICENSES/               # 分模块许可证与合规声明
```

通过在目录结构与构建开关上把主工作台与 `canvas-lab` 解耦，既保证了完整组合发行的合规性，也让只需要核心生成管线的开发者可以安心在 MIT 协议下复用代码。

## 总结

从 `suacanvas` 到 `picpilot-platform` 与 `picpilot-personal`，最大的收获不是换了一门语言，而是想清楚了**“重度运营平台”与“个人趁手工具”的边界**。把公共的 AI 生成与路由能力沉淀在极简的 Go 核心层，向上既能撑起多租户计费平台，向下也能缩成一个纯粹的个人创作桌面。
