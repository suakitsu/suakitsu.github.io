---
title: 给 Codex Desktop 加上沢渡雫桌宠与勿忘草皮肤：不碰安装包签名的本地 CDP 注入方案
date: 2026-11-09
slug: shizuku-codex-pet
category: 日常随想
tags: [创作, 二次元, 桌面美化, 小工具]
repo: https://github.com/suakitsu/shizuku-codex-pet
excerpt: 为 Codex Desktop 制作三套十六向视线追踪的沢渡雫 v2 动画桌宠（全身版 / 像素版 / Q 版），并通过 127.0.0.1 本地回环 CDP 在不触碰 WindowsApps 与 app.asar 签名的前提下注入勿忘草主题皮肤。
---

平时高频使用的开发工具，总希望能带一点自己喜欢的色彩。这个博客采用了清透的 **Alice Blue（爱丽丝蓝）** 主题，而我同样为日常使用的 Codex Desktop 制作了一套同色系的非官方、非商业同人扩展 —— [shizuku-codex-pet](https://github.com/suakitsu/shizuku-codex-pet)，包含三套以《美少女万華鏡 -忘れな草と永遠の少女-》**沢渡雫**为灵感的 v2 动画桌宠，以及配套的 Windows 勿忘草皮肤。

## 三套支持十六向注视的 Codex v2 动画桌宠

Codex Desktop 的 v2 桌宠系统支持丰富的状态机与鼠标视线追踪。为了让不同尺寸屏幕和审美偏好都能找到合适的陪伴感，我制作了三种不同画风的版本：

| 文件夹标识 | 风格版本 | 特点说明 |
| --- | --- | --- |
| `shizuku` | **全身表现版** | 完整呈现角色服饰与神态细节，动作过渡细腻 |
| `shizuku-pixel` | **复古像素版** | 颗粒感清晰的像素风格，适合搭配极客向代码编辑器 |
| `shizuku-q` | **可爱 Q 版** | 二头身比例，占用桌面视觉面积小，轻巧不挡代码 |

三套桌宠均包含 Codex v2 标准动作集与**顺时针十六向注视（16-direction clockwise gaze）**。安装时只需将对应的文件夹放入 `%USERPROFILE%\.codex\pets\`（或 `%CODEX_HOME%\pets\`），保持每个目录内的 `pet.json` 动作定义与 `spritesheet.webp` 精灵图成对即可：

```text
.codex/pets/
├── shizuku/
│   ├── pet.json
│   └── spritesheet.webp
├── shizuku-pixel/
│   ├── pet.json
│   └── spritesheet.webp
└── shizuku-q/
    ├── pet.json
    └── spritesheet.webp
```

## 为什么不用解包 `app.asar` 的方式改皮肤

在给 Windows 桌面端（尤其是通过 Microsoft Store 安装的 Codex 应用）换肤时，最常见但风险最高的做法是强行获取 `WindowsApps` 目录权限、解包修改 `app.asar` 再重新打包。这样做有三个很大的弊端：

1. **破坏应用数字签名**：容易导致 Windows 应用无法启动或更新失败；
2. **升级即失效**：每次官方客户端小版本更新都要重新解包替换；
3. **透明层冲突**：全局 CSS 覆盖很容易把 `/avatar-overlay` 桌宠悬浮窗背景也涂成不透明色块，导致桌宠变成“顶着一块背景板”。

## 基于本地回环（`127.0.0.1`）的无侵入皮肤注入

受 `Fei-Away/Codex-Dream-Skin` 思路启发，`shizuku-codex-pet` 的勿忘草皮肤采用了**纯本地回环 CDP（Chrome DevTools Protocol）样式注入**方案：

- **零文件篡改**：完全不触碰 `WindowsApps` 安装目录与 `app.asar`，不破坏任何官方签名，也不读取用户的 API Key 或聊天记录；
- **桌宠图层友好**：专门识别并跳过 `/avatar-overlay` 桌宠透明窗口，确保勿忘草浅蓝毛玻璃主界面与透明悬浮桌宠完美共存；
- **一键恢复与校验**：在 Releases 中分别提供了桌宠包（`v1.0.0`）与皮肤包（`skin-v1.0.0`），附带独立的安装/恢复脚本与 `.sha256` 完整性校验文件。

> 这是一个纯粹出于喜爱的非商业同人小作品（相关角色权利归原作权利方所有）。希望这抹勿忘草蓝也能让写代码的过程多一点轻松的心情。项目地址：[suakitsu/shizuku-codex-pet](https://github.com/suakitsu/shizuku-codex-pet)。
