---
title: 默认信任 A，审核回写 B：用 Go + Fyne 写一个克制的目录树同步工具 WayFileSync
date: 2026-11-12
slug: wayfilesync
category: 项目记录
tags: [Go, 小工具, 桌面开发]
repo: https://github.com/suakitsu/WayFileSync
excerpt: 通用同步工具功能强大，但在父子工作目录场景下很容易误覆盖。WayFileSync 把规则收敛为一件事：父目录 A 变更自动同步到 B，子目录 B 的修改必须先看 Unified Diff 审核后再回写。
---

市面上并不缺文件同步工具：FreeFileSync、Syncthing、rsync 都很成熟。但在我自己的工作流里，经常遇到一种非对称的目录同步需求——**主目录 `A` 是经过整理的基准仓库，派生工作目录 `B`（比如交给实验脚本、AI Agent 或外部工具处理的沙盒副本）需要时刻跟进 `A` 的更新，但 `B` 里面产生的修改绝不能未经检查就自动覆盖回 `A`。**

如果用传统双向同步，一旦 `B` 里的脚本改坏了文件，错误会立刻污染基准目录 `A`；如果每次手动比对整个目录树，在多层级子目录下又极其繁琐。于是我用 Go 和 Fyne 写了 [WayFileSync](https://github.com/suakitsu/WayFileSync)。

## 核心设计哲学：Default-Trust A, Review B

WayFileSync 故意砍掉了通用同步工具里复杂的双向冲突合并策略，只保留一条清晰的单向信任 + 审核回写规则：

1. **下行自动同步（`A -> B`）**：父节点 `A` 是受信任的基准源，`A` 中的新增与修改会自动同步到子节点 `B`；
2. **上行强制审核（`B -> A`）**：子节点 `B` 中发生的文件变更不会自动覆盖 `A`，而是进入待审核队列（Pending Review）；
3. **Unified Diff 逐项确认**：在 GUI 界面中直接查看文本文件的 Unified Diff 差异对比，确认无误后才回写到 `A`，或者一键用 `A` 重置 `B`。

```text
[ 基准父目录 A ] ──── 自动下行同步 (Auto Sync) ────▶ [ 派生子目录 B ]
       ▲                                                    │
       └──── 人工查看 Unified Diff 审核通过后回写 ──────────┘
```

## 树状同步拓扑与防环校验

除了单对 `A -> B` 目录外，有时一个基准目录会派生出多个子目录，甚至形成两层派生树（`A -> B -> C`）。WayFileSync 使用 `sync_tree.json` 来维护目录树拓扑，并在添加节点时执行两项严格的静态安全检查：

- **环路检测（Cycle Prevention）**：禁止任何节点直接或间接将自己的祖先节点设为下游；
- **父子目录嵌套拦截（Containment Check）**：严禁将 `C:\Work\Project` 与它的子文件夹 `C:\Work\Project\sub` 绑定为同步对，从根源上杜绝递归无限复制。

```json
{
  "nodes": [
    {
      "id": "root-workspace",
      "path": "C:/Workspace/BaseRepo",
      "children": ["sandbox-agent-a", "sandbox-agent-b"]
    }
  ]
}
```

## 用 Go + Fyne 构建原生 Windows 桌面工具的体感

选择 **Go + Fyne** 来写这个桌面小工具，主要是看中了它的单文件分发能力：

- 通过 CGO + MinGW-w64 编译后，产物就是一个独立的 Windows `.exe` 可执行文件，不依赖几十兆的 WebView2 或百兆以上的 Electron 运行时；
- 支持文件与文件夹直接拖拽（Drag & Drop）绑树、平级兄弟目录手动同步以及内置的差异高亮预览。

> 工具不一定越大越好。把一个高频痛点的交互收敛到“只做对一件事”，往往比配置一堆永远用不上的开关更让人安心。源码见 [suakitsu/WayFileSync](https://github.com/suakitsu/WayFileSync)。
