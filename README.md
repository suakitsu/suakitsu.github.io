# suakitsu.github.io

suakitsu 的个人博客首页。地址：https://suakitsu.github.io/

采用静态 HTML/CSS/JavaScript，GitHub Pages 从 `main` 根目录发布。

## 页面与修改位置

- `index.html`：首页资料、技术栈、文章占位区。
- `about.html`：关于页面。
- `categories.html`、`tags.html`、`year-archive.html`：内容为空时的分类、标签和归档页。
- `style.scss` / `style.css`：可编辑样式源码 / 已编译样式。
- `main.js`：主题切换、搜索空状态、移动导航、GitHub 项目数同步与 Cyber Swarm 入场动效。
- `avatar.png`、`favicon.png`：suakitsu 的 GitHub 头像。

首次访问首页播放构建动画。顶部星形按钮可重播，动画下方可切换倍速，
点关闭或按 Esc 可立即跳过。尊重系统减少动态效果设置，深浅主题可切换并记忆。

首页“项目”按 GitHub 公开仓库总数统计，包含博客和个人介绍仓库，点击可查看仓库列表。
页面通过 GitHub 公开 API 自动获取数量，每个浏览器缓存一小时；请求失败时保留缓存
或页面中的默认值（2026-11-09 核对为 9），无需访问令牌，也不读取私有仓库。

当前没有文章、分类、标签或评论数据。这里是首页起点，发布文章时需要同步
添加文章页、列表和搜索索引，或接入静态博客生成器。没有接入第三方统计与评论服务。

复用代码的来源与许可见 NOTICE.md 和 LICENSE。
