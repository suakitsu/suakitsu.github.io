# suakitsu.github.io

suakitsu 的个人博客。地址：https://suakitsu.github.io/

采用静态 HTML/CSS/JavaScript，GitHub Pages 从 `main` 根目录发布。

## 写文章与一键构建

所有文章的 Markdown 源码存放在 `posts/*.md`，支持 YAML Frontmatter：

```markdown
---
title: 文章标题
date: 2026-11-20
slug: custom-slug
category: 项目记录
tags: [Go, 小工具]
repo: https://github.com/suakitsu/your-repo
excerpt: 文章摘要说明。
---

这里使用标准 Markdown 编写正文...
```

新增或修改 `posts/*.md` 后，在仓库根目录运行：

```bash
node scripts/build-blog.mjs
```

脚本会自动完成以下工作（零第三方 npm 依赖）：
1. 生成 `posts/<slug>.html` 文章详情页（包含右侧悬浮目录 TOC、移动端折叠目录、阅读进度条、代码块一键复制与上下篇切换）；
2. 自动同步 `index.html` 的文章/分类/标签统计数字、Bento“近期文章速览”卡片与下方“最新文章”双列卡片列表；
3. 自动重新生成 `categories.html`、`tags.html`、`year-archive.html` 及全站页脚统计；
4. 自动生成 `search.json` 全文搜索索引（支持顶栏放大镜或 `Ctrl+K` 实时搜索）。

如修改了 `style.scss`，可通过 `npx sass --style=compressed --no-source-map style.scss style.css` 重新编译样式。

## 页面与目录结构

- `index.html`：首页资料、技术栈、近期文章速览与最新文章列表。
- `posts/*.md` / `posts/*.html`：文章 Markdown 源文件与生成的文章详情页。
- `scripts/build-blog.mjs`：Markdown 静态博客一键构建脚本。
- `categories.html`、`tags.html`、`year-archive.html`：分类、标签云和按年归档时间线页。
- `about.html`：关于页面。
- `style.scss` / `style.css`：可编辑样式源码 / 已编译样式。
- `main.js`：主题切换、站内全文搜索、代码复制、目录高亮、移动导航、GitHub 项目数同步与 Cyber Swarm 入场动效。
- `avatar.png`、`favicon.png`：suakitsu 的 GitHub 头像。

复用代码的来源与许可见 NOTICE.md 和 LICENSE。
