---
title: 给 Codex Desktop 加上沢渡雫桌宠与勿忘草皮肤：不碰安装包签名的本地 CDP 注入方案
date: 2026-11-09
slug: shizuku-codex-pet
category: 日常随想
tags: [创作, 二次元, 桌面美化, 小工具]
repo: https://github.com/suakitsu/shizuku-codex-pet
excerpt: 记录非官方同人项目 shizuku-codex-pet 的制作过程：如何为 Codex Desktop 制作三套支持顺时针十六向视线追踪的沢渡雫 v2 动画桌宠（全身版 / 像素版 / Q 版），以及如何通过 127.0.0.1 本地回环 CDP 在不破坏 Microsoft Store 应用签名的前提下注入勿忘草色系毛玻璃皮肤。
---

如果你刚点进这个博客，应该已经注意到了全站的主色调——清透的 **Alice Blue（爱丽丝蓝，`#f0f8ff` ~ `#2b8dd6`）**。我一直很喜欢这种干净、带一点冷调却不刺眼的浅蓝色系。

在日常写代码时，除了浏览器和 IDE，我打开频率最高的就是 **Codex Desktop**。看着默认的深灰/纯白界面久了，就萌生了一个想法：**能不能把《美少女万華鏡 -忘れな草と永遠の少女-》里的沢渡雫（Sawatari Shizuku）做成 Codex Desktop 的动画桌宠，再配上一套同色系的“勿忘草（Forget-Me-Not）”浅蓝毛玻璃皮肤？**

于是就有了这个纯粹出于喜爱的非官方、非商业同人扩展项目 —— [shizuku-codex-pet](https://github.com/suakitsu/shizuku-codex-pet)。这篇文章记录一下 Codex v2 桌宠规格的制作细节，以及 Windows 商店版客户端无侵入换肤的技术方案。

## 一、三套不同画风的沢渡雫 Codex v2 动画桌宠

Codex Desktop 的 v2 桌宠引擎（`spriteVersionNumber: 2`）相比早期版本，最大的升级在于支持**多状态动作序列**与**顺时针十六向视线追踪（16-direction clockwise gaze tracking）**——当你的鼠标光标在屏幕不同方位移动或敲击键盘时，桌宠的眼神与头部朝向会实时跟随光标所在象限自然转动。

为了适配不同分辨率的显示器和不同时期的桌面风格偏好，我一口气制作了三套独立画风的沢渡雫桌宠：

| 桌宠目录名 | 版本定位 | 精灵图体积 (`spritesheet.webp`) | 视觉特点与适用场景 |
| --- | --- | --- | --- |
| `shizuku` | **全身表现版** | ~2.15 MB | 完整保留角色标志性的银蓝长发、服饰褶皱与神态细节，待机呼吸感与视线转动最细腻 |
| `shizuku-pixel` | **复古像素版** | ~1.65 MB | 清晰的像素点阵风格，边缘锐利，搭配等宽代码字体与终端窗口毫无违和感 |
| `shizuku-q` | **可爱 Q 版** | ~2.56 MB | 二头身圆润比例，动态夸张可爱，放在屏幕右下角不遮挡代码编辑区 |

### 1. Codex v2 桌宠的目录契约与 `pet.json` 结构

在 Codex Desktop 中，每一个自定义 v2 桌宠都是 `%USERPROFILE%\.codex\pets\`（若配置了自定义环境变量，则为 `%CODEX_HOME%\pets\`）下的一个独立子文件夹，内部由一份描述元数据的 `pet.json` 和一张高压缩率的 WebP 精灵图 `spritesheet.webp` 组成：

```json
{
  "id": "shizuku",
  "displayName": "Shizuku",
  "description": "An unofficial fan-made full-body Sawatari Shizuku pet with expressive reactions and 16 looking directions.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

### 2. 十六向注视与精灵图帧对齐的注意点

在制作 `spritesheet.webp` 时，最考验耐心的是**十六个注视方向的角度一致性与重心对齐**：

1. **顺时针角度映射**：从正上方（12 点钟方向）开始，每隔 $22.5^\circ$ 为一个朝向切片，顺时针旋转一周共 16 个方向。如果其中某两个相邻切片的头部俯仰角或瞳孔高光位移跳变过大，鼠标快速划过屏幕时就会产生“抽搐感”；
2. **透明包围盒（Bounding Box）基准线固定**：无论是全身版、像素版还是 Q 版，同一套动作序列下每一帧的脚底（或坐姿基准线）像素坐标必须严格锁死，否则切换动作状态或转头时角色会在桌面上轻微漂移；
3. **无损/高画质 WebP 封装**：为了兼顾加载速度与半透明发丝边缘的抗锯齿效果，最终统一输出为带 Alpha 通道的 `spritesheet.webp`，并且严格要求 `pet.json` 与同目录的 `spritesheet.webp` 成对存放、不可拆散。

安装方式非常简单，从 Releases 下载 `shizuku-codex-pets-v1.0.0.zip` 解压后放入对应目录，最终结构如下：

```text
%USERPROFILE%\.codex\pets\
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

## 二、Windows 客户端换肤的难题：为什么绝不能去改 `WindowsApps` 与 `app.asar`？

有了沢渡雫桌宠之后，如果主界面还是原版单调的配色，总觉得差了一点氛围。但要给 Windows 版的 Codex Desktop 换上一套“勿忘草（Forget-Me-Not）”浅蓝主题皮肤，首先会遇到一个棘手的系统限制：

**Windows 上的 Codex Desktop 通常是通过 Microsoft Store（MSIX / AppX 包）安装并托管在 `C:\Program Files\WindowsApps\` 目录下的。**

很多传统的 Electron 客户端美化补丁采取的是“暴力解包流”：
1. 强行用管理员权限接管 `WindowsApps` 系统目录的所有权；
2. 解包客户端核心的 `resources/app.asar`；
3. 往里面塞入自定义 CSS / JS 后重新打包覆盖。

这种做法在 Microsoft Store 应用上有**三个致命缺陷**：

| 传统 `app.asar` 解包篡改方案的弊端 | 实际后果 |
| --- | --- |
| **1. 破坏 MSIX 包数字签名与完整性校验** | Windows 系统更新或重启后，极易判定应用文件损坏，直接拒绝启动甚至强制重装 |
| **2. 强改 `WindowsApps` ACL 权限留隐患** | 修改受保护系统目录的 NTFS 权限很容易把整个 Windows Store 其他应用的更新链路搞坏 |
| **3. 全局 CSS 误伤桌宠透明悬浮窗** | 桌宠本身运行在独立的 `/avatar-overlay` 透明 WebView 窗口中；如果无差别注入全局背景色，桌宠背后会多出一块不透明的矩形色块！ |

## 三、受 `Codex-Dream-Skin` 启发：纯本地回环（`127.0.0.1`）CDP 注入方案

为了做到**“零文件篡改、随时一键完整恢复、绝不破坏桌宠透明层”**，我在制作 `shizuku-codex-pet` 的 Windows 勿忘草皮肤（`skin-v1.0.0`）时，参考并基于 `Fei-Away/Codex-Dream-Skin` 的架构思路，采用了**本地回环（Loopback-Only `127.0.0.1`）CDP 动态样式注入**机制：

```text
[ Windows 勿忘草皮肤启动器 (仅监听本机 127.0.0.1) ]
                     │
                     │ 通过本地 CDP 枚举渲染页面 Target
                     ▼
        ┌────────────────────────┴────────────────────────┐
        ▼                                                 ▼
[ 主界面 Target (Main Workbench) ]             [ 桌宠悬浮层 (/avatar-overlay) ]
  ✓ 注入勿忘草浅蓝 CSS 变量与毛玻璃背景             ✗ 显式跳过背景注入！
  ✓ 调整侧栏、代码块、对话气泡与滚动条色调          ✓ 100% 保持窗口 Alpha 透明通道
```

这套方案在工程与安全性上有四个核心保障：

1. **只走本机回环（`127.0.0.1`），绝不外联**：皮肤注入器仅在本机回环地址与客户端调试端口通信，没有任何外部网络请求，更不会读取、接触用户的 API Key、账号凭证或本地聊天数据库；
2. **零安装包改动**：不碰 `WindowsApps`、不解包 `app.asar`、不改任何官方二进制签名。无论客户端怎么升级，或者你想随时换回原版，都不会把客户端搞崩；
3. **精准识别并保护 `/avatar-overlay` 桌宠透明层**：注入逻辑在遍历页面 Target 时，会显式检查页面 URL/路由——遇到 `/avatar-overlay` 桌宠专属悬浮窗时自动跳过背景与容器样式覆盖，让沢渡雫桌宠能够干干净净地悬浮在桌面与勿忘草主界面之上；
4. **独立发行包、一键恢复与 SHA-256 强校验**：在仓库的 Releases 页面中，我将**桌宠资产包（`v1.0.0`）**与**Windows 勿忘草皮肤包（`skin-v1.0.0`）**拆分为两个互不绑架的独立发行项——你可以只装桌宠、不装皮肤，也可以两者一起用；每个发行包都配有独立的一键安装/一键完整恢复脚本以及 `.sha256` 校验文件。

## 四、关于同人创作与开源合规的边界

作为一个非官方、非商业的同人项目，我在建仓之初就对仓库内容和许可证边界做了严格的清理：

- **权利归属声明**：本项目与 OpenAI、Codex、ωstar 及原作作者无任何隶属或授权关系；沢渡雫角色设定、作品名称与原作权利均归各自权利方所有；
- **纯净仓库承诺**：仓库内仅包含最终制作完成的 v2 桌宠配置与精灵图，不夹带任何官方游戏解包原图、商业游戏文件、官方 Logo 或私人生成日志，并在 [ASSET_LICENSE.md](https://github.com/suakitsu/shizuku-codex-pet/blob/main/ASSET_LICENSE.md) 与 [LICENSE](https://github.com/suakitsu/shizuku-codex-pet/blob/main/LICENSE) 中明确区分了代码文档许可与视觉素材的使用限制。

写代码是一件漫长而需要耐心的事。如果你也在用 Codex Desktop，同时恰好喜欢《美少女万華鏡》里的沢渡雫或是这抹安静的勿忘草蓝，欢迎到 [suakitsu/shizuku-codex-pet](https://github.com/suakitsu/shizuku-codex-pet) 下载体验。
