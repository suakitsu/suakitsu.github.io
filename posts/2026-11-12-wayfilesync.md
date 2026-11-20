---
title: 默认信任 A，审核回写 B：用 Go + Fyne 写一个克制的目录树同步工具 WayFileSync
date: 2026-11-12
slug: wayfilesync
category: 项目记录
tags: [Go, 小工具, 桌面开发]
repo: https://github.com/suakitsu/WayFileSync
excerpt: 为什么在有了 FreeFileSync 和 Syncthing 之后还要自己写一个桌面同步器？本文拆解 WayFileSync 的非对称同步哲学与 Go 核心实现：防嵌套拓扑校验、fsnotify 自写回声抑制、基于文件签名的重命名识别，以及 Myers Unified Diff 审核回写机制。
---

在日常开发与多 Agent 协作的工作流里，我经常需要维护这样一种目录结构：

> 我有一个主工作目录 **A**（干净的基准代码库），以及一个或多个从 **A** 派生出来的副本目录 **B**（比如交给自动化脚本、AI 编码助手或实验分支折腾的沙盒目录）。
> - 当我在主目录 **A** 修改了代码时，我希望所有副本目录 **B** 能**自动、实时地跟着更新**；
> - 但当副本目录 **B** 里的脚本或 Agent 修改、删除了文件时，**绝不能自动覆盖回主目录 A**，必须先进入一个待审核列表，让我看一眼 Unified Diff 差异对比、勾选确认之后，才允许回写到 **A**。

为了这个看似简单却极其高频的场景，我试过市面上几乎所有主流的文件同步工具（FreeFileSync、Syncthing、rsync 脚本），最后决定用 **Go + Fyne** 自己写一个足够克制的原生桌面工具 —— [WayFileSync](https://github.com/suakitsu/WayFileSync)。

## 一、为什么通用同步工具在这个场景下“太重又太危险”

FreeFileSync 和 Syncthing 都是非常优秀的开源软件，它们也给了我很多启发：FreeFileSync 的“对比 $\rightarrow$ 预览 $\rightarrow$ 确认”流程非常清晰，而 Syncthing 的 `fsnotify` 实时目录监听与多节点拓扑很实用。

但问题在于：**通用同步工具默认把两边当作地位对等的节点（Peer-to-Peer）或纯粹的单向镜像（Mirror）**。

- 如果配成**双向实时同步**：一旦副本目录 `B` 里的实验脚本跑飞了、误删了文件或改乱了配置，毫秒级的实时同步会立刻把灾难同步回主目录 `A`；
- 如果配成**纯单向镜像（`A -> B`）**：当 `B` 里面产出了有价值的修改，你想把其中 3 个文件挑出来合回 `A` 时，单向镜像没有反向的 Diff 审核与勾选提交流程，甚至下一次 `A` 触发同步时还会把你在 `B` 里还没来得及拷走的新代码直接抹掉！

所以，WayFileSync 的核心设计哲学只有一句话：**默认信任父目录 A，谨慎审核子目录 B（Default-Trust A, Review B）**。

```text
                  ┌────────────────────────┐
                  │   基准根目录 Root (A)   │
                  └───────────┬────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │ 1. A 修改时：自动下行同步 (跳过 B 待审核文件) │
        ▼                                           ▼
┌───────────────────┐                       ┌───────────────────┐
│  派生副本 Copy 1   │ ── 3. 同级手动对比 ──▶ │  派生副本 Copy 2   │
└─────────┬─────────┘                       └───────────────────┘
          │
          │ 2. B 修改时：拦截进入 Pending 队列
          │    人工预览 Myers Unified Diff 并勾选确认后，备份并回写至 A
          ▼
  [ 待审核变更列表 ]
```

## 二、深入 Go 核心实现：四个关键工程细节

虽然 WayFileSync 的界面和交互做得很轻，但在底层文件同步引擎（`internal/model`、`internal/sync`、`internal/watcher`）里，要保证“绝不丢文件、绝不死循环”需要处理好四个非常具体的技术细节。

### 1. 树状拓扑校验与防嵌套死循环（`sameOrNested`）

WayFileSync 支持在 `sync_tree.json` 中定义任意多层级的父子目录树（例如 `root -> copy1 -> copy1-child`）。但用户在通过文件选择框或拖拽绑定目录时，最容易犯的一个致命错误是：**把子文件夹建在了父文件夹内部**（例如把 `D:/ERP/main` 设为 A，把 `D:/ERP/main/backup` 设为 B）。

一旦允许包含关系的两个目录建立同步，第一次同步就会把 `backup` 拷进 `backup/backup`，瞬间触发无限递归的目录爆炸。

为此，`internal/model/config.go` 在加载和保存配置时，都会对所有节点两两执行基于 `filepath.Rel` 的相对路径包含检测：

```go
func (c *Config) Validate() error {
	seen := map[string]bool{}
	for _, n := range c.Nodes {
		if seen[n.ID] {
			return fmt.Errorf("duplicate node id %q", n.ID)
		}
		seen[n.ID] = true
	}
	for _, n := range c.Nodes {
		if n.Parent != "" && !seen[n.Parent] {
			return fmt.Errorf("node %q has missing parent %q", n.ID, n.Parent)
		}
	}
	for i := range c.Nodes {
		for j := i + 1; j < len(c.Nodes); j++ {
			a, err := filepath.Abs(c.Nodes[i].Path)
			if err != nil {
				return err
			}
			b, err := filepath.Abs(c.Nodes[j].Path)
			if err != nil {
				return err
			}
			if sameOrNested(a, b) {
				return fmt.Errorf(
					"不能选择彼此包含的文件夹：%q 和 %q；请选择两个独立目录，避免同步循环",
					c.Nodes[i].ID, c.Nodes[j].ID,
				)
			}
		}
	}
	return nil
}

func sameOrNested(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if a == b {
		return true
	}
	rel, err := filepath.Rel(a, b)
	if err == nil && rel != "." && !startsDotDot(rel) {
		return true
	}
	rel, err = filepath.Rel(b, a)
	return err == nil && rel != "." && !startsDotDot(rel)
}
```

同时，引擎默认内置了对 `logs/`、`tmp/`、`cache/`、`sessions/`、`node_modules/`、`vendor/` 和 `.git/` 的忽略规则，避免同步构建噪音与 Git 内部对象锁。

### 2. 父目录自动下发时的“待审核路径保护”（Pending Exclusion）

这是一个很多人在写单向同步时容易忽略的边界情况：**假设子目录 `B` 已经修改了 `main.go`（处于 `StatusPending` 待审核状态，还没提交回 `A`），此时父目录 `A` 修改了另一个文件 `README.md` 触发了 `A -> B` 自动下发。如果 `A -> B` 无脑全量覆盖，那么 `B` 中尚未审核的 `main.go` 就会被 `A` 的旧版本冲掉！**

在 `internal/sync/tree_sync.go` 的 `SyncParentToChildren` 实现中，我加入了**先刷新子目录索引、再提取待审核路径排除集（`exclude := c.pendingPaths(childID)`）**的保护逻辑：

```go
func (c *Controller) SyncParentToChildren(id string) error {
	// 1. 下发前先根据最新文件索引刷新各子节点的 Pending 变更集
	for _, childID := range c.Children[id] {
		if err := c.refreshChildPendingFromIndex(childID); err != nil {
			c.SetStatus(childID, StatusFailed)
			return err
		}
	}
	return c.RunInternal(func() error {
		parent := c.Nodes[id]
		for _, childID := range c.Children[id] {
			child := c.Nodes[childID]
			// 2. 提取该子节点所有处于待审核状态的相对路径（含重命名源路径）
			exclude := c.pendingPaths(childID)
			// 3. 同步时自动跳过子目录中正在等待人工审核的文件，防止静默覆盖
			if err := SyncDirWithOptions(parent.Path, child.Path, SyncOptions{
				Exclude: exclude,
				Ignore:  c.ignorePair(id, childID),
			}); err != nil {
				c.SetStatus(childID, StatusFailed)
				return err
			}
			if len(exclude) > 0 {
				c.Log("%s synced to %s; skipped %d pending path(s)", id, childID, len(exclude))
			}
		}
		return nil
	})
}
```

### 3. `fsnotify` 自写回声抑制（Internal Write Suppression）

当 WayFileSync 自己把文件从 `A` 拷贝到 `B`，或者把审核通过的文件从 `B` 写回 `A` 时，Windows 文件系统的 `fsnotify` 监听器同样会收到由程序自身引发的 `WRITE / CREATE / RENAME` 事件。如果不加区分，程序自己的同步动作又会触发新一轮的扫描和同步回声。

更重要的是，在 Windows 下，操作系统内核投递文件变更通知往往比 `os.WriteFile` / `io.Copy` 函数返回**滞后几十到几百毫秒**。如果只用一个布尔锁在函数返回瞬间就释放，滞后到达的 `fsnotify` 事件依然会漏进来。

因此，`Controller` 结合了**原子递归深度计数器（`internalDepth atomic.Int32`）**与**900 毫秒尾迹静默窗口（`lastInternal atomic.Int64`）**：

```go
func (c *Controller) IsInternalWrite() bool {
	if c.internalDepth.Load() > 0 {
		return true
	}
	// Windows 下 fsnotify 事件可能在文件拷贝返回后延迟到达，保留 900ms 静默期
	return time.Since(time.UnixMilli(c.lastInternal.Load())) < 900*time.Millisecond
}

func (c *Controller) RunInternal(fn func() error) error {
	c.internalDepth.Add(1)
	defer func() {
		c.lastInternal.Store(time.Now().UnixMilli())
		c.internalDepth.Add(-1)
	}()
	return fn()
}
```

### 4. 重命名智能识别（`detectRenames`）、Myers Diff 预览与写前自动备份

当你在子目录 `B` 中把一个文件重命名或移动到另一个子文件夹时，朴素的目录对比会把它当成“删除了旧文件 `D` + 新增了新文件 `A`”。在 `internal/sync/diff.go` 中，`detectRenames` 会通过文件大小与纳秒级修改时间构造签名 `fileSig(info)`（`size:modTimeUnixNano`）：当新增项与删除项签名唯一匹配时，自动将其归并为一条 `StatusRenamed (R)` 变更（显示为 `old/path.go -> new/path.go`）。

而在差异预览与回写安全性上：

- **纯 Go 原生 Myers Unified Diff**：通过 `github.com/hexops/gotextdiff/myers` 直接在内存中计算文本文件的差异补丁，并在自动校验 UTF-8 有效性后屏蔽二进制乱码；
- **写前强制备份与一键回滚**：在 `ApplyChanges` 将变更应用到目标目录（无论是修改、删除还是重命名）之前，都会先调用 `BackupFile(dst.Path, ch.RelPath)` 保存历史版本快照，随时支持通过 `RestoreLatestVersion` 一键后悔还原。

| 变更状态 | 标识 | 触发条件 | 回写父目录时的安全动作 |
| --- | --- | --- | --- |
| **新增** | `A` (Added) | 子目录存在、父目录不存在 | 检查目标路径 $\rightarrow$ 拷贝新文件 $\rightarrow$ 更新节点索引 |
| **修改** | `M` (Modified) | 双方均存在但大小或修改时间/内容不同 | **自动备份父目录原文件** $\rightarrow$ 覆盖写入 $\rightarrow$ 支持一键回滚 |
| **删除** | `D` (Deleted) | 父目录存在、子目录已删除 | **自动备份父目录原文件** $\rightarrow$ 执行删除 $\rightarrow$ 更新节点索引 |
| **重命名** | `R` (Renamed) | 唯一匹配 `size:modTime` 签名的删增对 | **备份新旧路径** $\rightarrow$ 执行 `os.Rename` 与内容同步 |

## 三、交互打磨与 Windows 单文件打包

为了日常用起来足够顺手，我在 Fyne GUI 层也加了不少小细节：

- **全场景拖拽（Drag & Drop）**：还没配目录时拖入文件夹直接设为根目录 `A`；已选中某个节点时拖入新文件夹，弹窗询问“替换当前路径”还是“添加为下级同步副本”；甚至不小心拖入了一个具体的文件时，程序也会自动取其所在的父文件夹路径；
- **平级兄弟节点手动同步**：除了父子同步外，同属一个父节点的两个兄弟副本（如 `copy1` 与 `copy2`）之间也可以手动发起差异扫描并勾选同步；
- **纯净单文件分发**：利用 MSYS2 / MinGW-w64 与 `-ldflags="-H=windowsgui -s -w"` 编译后，产物只有一个几兆大小的独立 `WayFileSync.exe`，加上旁边一个人类可读的 `sync_tree.json` 即可拷贝到任何 Windows 机器上即开即用。

```powershell
# 在 Windows 下使用 MinGW-w64 编译无黑框的单文件桌面程序
cd WayFileSync
$env:Path = "C:\msys64\ucrt64\bin;$env:Path"
$env:CGO_ENABLED = "1"
go build -trimpath -ldflags="-H=windowsgui -s -w" -o dist\WayFileSync.exe ./cmd/tree-sync
```

## 四、小结

很多时候，“自己造轮子”并不是因为现有的轮子不够强大，而是因为**通用工具为了照顾所有人，不得不把安全边界交给用户自己去配置**。通过把规则写死在“父目录自动下发、子目录审核回写”，WayFileSync 让我可以放心地把副本目录交给任何自动化脚本或 AI Agent 折腾，而永远不必担心基准代码库被意外破坏。

项目源码与英文文档已开源在：[suakitsu/WayFileSync](https://github.com/suakitsu/WayFileSync)。
