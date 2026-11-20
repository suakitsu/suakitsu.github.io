import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'posts');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: match[2] };
}

function renderInline(text) {
  const codeSpans = [];
  let processed = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  processed = escapeHtml(processed);

  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const isExternal = /^https?:\/\//i.test(url) && !url.includes('suakitsu.github.io');
    const attrs = isExternal ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${url}"${attrs}>${label}</a>`;
  });

  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  processed = processed.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeSpans[Number(idx)]);
  return processed;
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const toc = [];
  let headingCounter = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = (fenceMatch[1] || 'text').toUpperCase();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      html.push(
        `<div class="code-block-wrapper">` +
          `<div class="code-block-header">` +
            `<div class="code-block-dots"><span class="code-block-dot"></span><span class="code-block-dot"></span><span class="code-block-dot"></span></div>` +
            `<span class="code-block-lang">${escapeHtml(lang)}</span>` +
          `</div>` +
          `<button class="code-copy-btn" type="button" aria-label="复制代码"><span class="copy-text">复制</span></button>` +
          `<pre class="highlight"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>` +
        `</div>`
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawTitle = headingMatch[2].trim();
      headingCounter++;
      const id = `section-${headingCounter}`;
      const plainTitle = rawTitle.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
      toc.push({ level, id, text: plainTitle });
      html.push(`<h${level} id="${id}">${renderInline(rawTitle)}</h${level}>`);
      i++;
      continue;
    }

    // Table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const parseRow = row =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(c => renderInline(c.trim()));
      const headers = parseRow(lines[i]);
      i += 2; // skip header and separator
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
      html.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
        i++;
      }
      html.push(`<ul>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
        i++;
      }
      html.push(`<ol>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^#{2,4}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
  }

  return { html: html.join('\n'), toc };
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderShell({ title, description, canonicalPath, activeNav, mainHtml, statsText, isHome = false }) {
  const navItems = [
    { href: '/', label: '首页', key: 'home' },
    { href: '/categories.html', label: '分类', key: 'categories' },
    { href: '/tags.html', label: '标签', key: 'tags' },
    { href: '/year-archive.html', label: '归档', key: 'archive' },
    { href: '/about.html', label: '关于', key: 'about' }
  ];

  const desktopLinks = navItems
    .map(item => {
      const active = item.key === activeNav ? ' active" aria-current="page' : '';
      return `        <a href="${item.href}" class="nav-link${active}">${item.label}</a>`;
    })
    .join('\n');

  const mobileLinks = navItems
    .map(item => {
      const active = item.key === activeNav ? ' active" aria-current="page' : '';
      return `  <a href="${item.href}" class="mobile-link${active}">${item.label}</a>`;
    })
    .join('\n');

  const headScript = isHome
    ? `(() => { try {
  const saved = localStorage.getItem('suakitsu-theme');
  document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const home = location.pathname === '/' || location.pathname === '/index.html';
  const force = new URLSearchParams(location.search).get('intro') === '1';
  if (home && !matchMedia('(prefers-reduced-motion: reduce)').matches && (!localStorage.getItem('suakitsu_intro_seen_v1') || force)) {
    document.documentElement.classList.add('swarm-intro-preparing');
    setTimeout(() => document.documentElement.classList.remove('swarm-intro-preparing'), 3500);
  }
} catch {} })();`
    : `(() => { try {
  const saved = localStorage.getItem('suakitsu-theme');
  document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch {} })();`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f0f8ff"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="https://suakitsu.github.io${canonicalPath}"><link rel="icon" href="/favicon.png" type="image/png"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="https://suakitsu.github.io${canonicalPath}"><meta property="og:type" content="website"><meta property="og:image" content="https://suakitsu.github.io/avatar.png"><script>${headScript}</script><link rel="stylesheet" href="/style.css"><script src="/main.js" defer></script></head>
<body><div id="pageStart" aria-hidden="true" style="height:1px;position:absolute;top:0"></div><div class="skip-links"><a href="#main">跳到主要内容</a></div><nav class="navbar" id="site-nav" aria-label="主导航">
  <div class="container">
    <a href="/" class="logo">
      <span class="logo-text">suakitsu</span>
    </a>
    
    <div class="nav-right">
      <div class="nav-links">
${desktopLinks}
        <a href="https://github.com/suakitsu" target="_blank" rel="noopener" class="nav-link">GitHub</a>
      </div>
      
      <button class="swarm-replay-toggle" id="swarmReplayBtn" aria-label="重播页面构建动效" title="重播页面构建动效">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
          <path d="M5 3v4"/><path d="M3 5h4"/>
        </svg>
      </button>

      <button class="search-toggle" id="searchToggle" aria-label="搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </button>
      
      <button class="theme-toggle" id="themeToggle" aria-label="切换主题" aria-pressed="false">
        <span class="icon-moon">🌙</span>
        <span class="icon-sun">☀️</span>
      </button>
      
      <button class="menu-toggle" id="menuToggle" aria-label="菜单" aria-controls="mobileMenu" aria-expanded="false">
        ☰
      </button>
    </div>
  </div>
</nav>


<div class="mobile-overlay" id="mobileOverlay"></div>
<div class="mobile-menu" id="mobileMenu">
${mobileLinks}
  <a href="https://github.com/suakitsu" target="_blank" rel="noopener" class="mobile-link">GitHub</a>
</div>
<main id="main" class="main-content">${mainHtml}</main><footer class="footer" id="footer"><div class="container"><div class="footer-content"><div class="footer-info"><p class="footer-title">suakitsu 的个人博客</p><p class="footer-subtitle">想法、项目与日常，慢慢记录。</p></div><div class="footer-links"><a href="https://github.com/suakitsu" target="_blank" rel="noopener">GitHub</a><a href="/about.html">关于</a><a href="mailto:suakitsu@163.com">联系邮箱：suakitsu@163.com</a></div><div class="footer-stats">${statsText}</div><div class="footer-copyright"><p>© 2026 suakitsu</p></div></div></div></footer><dialog class="search-modal" id="searchModal" aria-labelledby="searchTitle"><div class="search-modal-overlay" id="searchOverlay" aria-hidden="true"></div><div class="search-modal-content"><h2 class="sr-only" id="searchTitle">搜索文章</h2><div class="search-modal-header"><input type="search" class="search-input" id="searchInput" placeholder="搜索文章..." aria-label="搜索文章关键词" autocomplete="off"><button class="search-close" id="searchClose" aria-label="关闭搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18m0-12 12 12"/></svg></button></div><div class="search-results search-hint" id="searchResults" role="status">输入关键词搜索文章...</div></div></dialog><button class="back-to-top" id="backToTop" aria-label="返回顶部"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg></button></body></html>
`;
}

function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = files.map(file => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const slug = meta.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    const date = meta.date || (file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '2026-11-20');
    const title = meta.title || slug;
    const category = meta.category || '未分类';
    const tags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];
    const plain = stripMarkdown(body);
    const excerpt = meta.excerpt || plain.slice(0, 110) + (plain.length > 110 ? '...' : '');
    const readMinutes = Math.max(1, Math.round(plain.length / 320));
    const { html, toc } = renderMarkdown(body);
    return {
      slug,
      url: `/posts/${slug}.html`,
      title,
      date,
      shortDate: date.slice(5),
      year: date.slice(0, 4),
      category,
      tags,
      repo: meta.repo || '',
      excerpt,
      plain,
      readMinutes,
      html,
      toc
    };
  });

  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return posts;
}

function build() {
  const posts = loadPosts();
  const categoriesMap = new Map();
  const tagsMap = new Map();
  const yearsMap = new Map();

  for (const post of posts) {
    if (!categoriesMap.has(post.category)) categoriesMap.set(post.category, []);
    categoriesMap.get(post.category).push(post);

    for (const tag of post.tags) {
      if (!tagsMap.has(tag)) tagsMap.set(tag, []);
      tagsMap.get(tag).push(post);
    }

    if (!yearsMap.has(post.year)) yearsMap.set(post.year, []);
    yearsMap.get(post.year).push(post);
  }

  const statsText = `${posts.length} 篇文章 · ${categoriesMap.size} 个分类`;

  // Clean old generated .html files in posts/ before regenerating
  if (fs.existsSync(POSTS_DIR)) {
    for (const file of fs.readdirSync(POSTS_DIR)) {
      if (file.endsWith('.html')) {
        fs.unlinkSync(path.join(POSTS_DIR, file));
      }
    }
  }

  // 1. Generate individual post HTML files
  for (let idx = 0; idx < posts.length; idx++) {
    const post = posts[idx];
    const prevPost = posts[idx + 1] || null;
    const nextPost = posts[idx - 1] || null;

    const tocLinksHtml = post.toc
      .map(item => {
        const cls = item.level === 3 ? ' toc-h3' : item.level === 4 ? ' toc-h4' : '';
        return `<a href="#${item.id}" class="toc-link${cls}">${escapeHtml(item.text)}</a>`;
      })
      .join('');

    const tocMobileHtml =
      post.toc.length > 0
        ? `<div class="toc-mobile"><button type="button" class="toc-mobile-toggle" id="tocMobileToggle" aria-expanded="false"><span>文章目录</span><span class="toc-toggle-icon">▼</span></button><nav class="toc-mobile-nav" id="tocMobileNav" aria-label="移动端文章目录">${tocLinksHtml}</nav></div>`
        : '';

    const tocSidebarHtml =
      post.toc.length > 0
        ? `<aside class="toc-sidebar" aria-label="文章目录"><div class="toc-header">目录</div><nav class="toc-nav">${tocLinksHtml}</nav></aside>`
        : '';

    const repoBadgeHtml = post.repo
      ? `<a href="${escapeHtml(post.repo)}" target="_blank" rel="noopener" class="post-repo-link">GitHub 仓库 ↗</a>`
      : '';

    const tagsFooterHtml = post.tags
      .map(t => `<a href="/tags.html#tag-${ encodeURIComponent(t) }" class="tag">#${escapeHtml(t)}</a>`)
      .join('');

    const prevHtml = prevPost
      ? `<a href="${prevPost.url}" class="nav-item prev"><span class="nav-label">← 上一篇</span><span class="nav-title">${escapeHtml(prevPost.title)}</span></a>`
      : `<div></div>`;
    const nextHtml = nextPost
      ? `<a href="${nextPost.url}" class="nav-item next"><span class="nav-label">下一篇 →</span><span class="nav-title">${escapeHtml(nextPost.title)}</span></a>`
      : `<div></div>`;

    const postMainHtml = `<div class="reading-progress-bar" id="readingProgressBar" aria-hidden="true"></div><article class="post-article-section"><div class="container"><nav class="breadcrumb" aria-label="面包屑导航"><a href="/">首页</a><span class="separator">/</span><a href="/categories.html#cat-${encodeURIComponent(post.category)}">${escapeHtml(post.category)}</a><span class="separator">/</span><span class="current">${escapeHtml(post.title)}</span></nav><header class="post-header"><div class="post-meta"><a href="/categories.html#cat-${encodeURIComponent(post.category)}" class="post-category">${escapeHtml(post.category)}</a><time datetime="${post.date}">${post.date}</time><span class="read-time">约 ${post.readMinutes} 分钟阅读</span>${repoBadgeHtml}</div><h1 class="post-title">${escapeHtml(post.title)}</h1><p class="post-excerpt">${escapeHtml(post.excerpt)}</p></header>${tocMobileHtml}<div class="post-content-wrapper"><div class="post-content">${post.html}</div>${tocSidebarHtml}</div><footer class="post-footer-section"><div class="post-tags">${tagsFooterHtml}</div><nav class="post-navigation" aria-label="上下篇导航">${prevHtml}${nextHtml}</nav></footer></div></article>`;

    const pageHtml = renderShell({
      title: `${post.title} · suakitsu`,
      description: post.excerpt,
      canonicalPath: post.url,
      activeNav: '',
      mainHtml: postMainHtml,
      statsText
    });

    fs.writeFileSync(path.join(POSTS_DIR, `${post.slug}.html`), pageHtml, 'utf8');
  }

  // 2. Build index.html
  const latestPreviewHtml =
    posts.length > 0
      ? posts
          .slice(0, 3)
          .map(
            p =>
              `          <a href="${p.url}" class="bento-latest-item"><span class="latest-item-date">${p.shortDate}</span><span class="latest-item-title">${escapeHtml(p.title)}</span><span class="latest-item-cat">${escapeHtml(p.category)}</span></a>`
          )
          .join('\n')
      : `          <div class="bento-latest-item empty-preview"><span class="latest-item-title">还没有文章</span><p>第一篇文章正在准备中。</p></div>`;

  const postsSectionBodyHtml =
    posts.length > 0
      ? `<div class="posts-grid" id="postsGrid">${posts
          .map(
            p =>
              `<article class="post-card reveal"><div class="post-meta"><a href="/categories.html#cat-${encodeURIComponent(p.category)}" class="post-category">${escapeHtml(p.category)}</a><time datetime="${p.date}">${p.date}</time>${p.repo ? `<a href="${escapeHtml(p.repo)}" target="_blank" rel="noopener" class="post-repo-link">GitHub ↗</a>` : ''}</div><h3 class="post-title"><a href="${p.url}">${escapeHtml(p.title)}</a></h3><p class="post-excerpt">${escapeHtml(p.excerpt)}</p><div class="post-footer"><div class="post-tags">${p.tags
                .map(t => `<a href="/tags.html#tag-${encodeURIComponent(t)}" class="tag">#${escapeHtml(t)}</a>`)
                .join('')}</div><span class="read-time">${p.readMinutes} 分钟阅读</span></div></article>`
          )
          .join('')}</div>`
      : `<div class="empty-posts reveal"><h2>还没有发布文章</h2><p>先把小站搭好，再慢慢留下记录。</p></div>`;

  const heroIntroDesc =
    posts.length > 0
      ? '这里记录我的开源项目、技术实践与日常随想。常写 Go、Python、Java 与 TypeScript，喜欢折腾 AI 工具与桌面小应用。'
      : '这里将记录我的想法、项目与日常。第一篇文章正在准备中。';

  const indexMainHtml = `
<section class="hero hero-bento-screen" id="heroSection">
  <div class="container hero-bento-container">
    
    <div class="decoration decoration-1"></div>
    <div class="decoration decoration-2"></div>

    <div class="bento-grid" id="heroBentoGrid">
      
      <div class="bento-card bento-intro">
        <div class="bento-intro-top">
          <div class="hero-badge">
            <span class="hero-badge-dot"></span>
            <span>记录想法，慢慢更新</span>
          </div>
          <div class="hero-location"><span>个人博客</span></div>
        </div>

        <div class="bento-intro-body">
          <span class="hero-greeting">你好，我是</span>
          <div class="hero-title-row">
            <h1 class="hero-name">suakitsu</h1>
            <span class="hero-subtitle-pill">想法与日常</span>
          </div>
          <p class="hero-description">
            ${heroIntroDesc}
          </p>
        </div>

        <div class="hero-links">
          <a href="https://github.com/suakitsu" target="_blank" rel="noopener" class="hero-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a href="#contentStart" class="hero-link hero-link-ghost">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            阅读文章
          </a>
        </div>
      </div>

      
      <div class="bento-card bento-profile avatar-card">
        <div class="profile-card-main">
          <div class="avatar-wrapper">
            <img src="/avatar.png" alt="suakitsu" loading="eager">
          </div>
          <div class="profile-card-info">
            <div class="avatar-name">suakitsu</div>
            <div class="avatar-role">个人博客</div>
            <div class="avatar-tags">
              <span class="avatar-mini-tag">想法</span>
              <span class="avatar-mini-tag">项目</span>
              <span class="avatar-mini-tag">日常</span>
            </div>
          </div>
        </div>
        <div class="avatar-stats">
          <a href="https://github.com/suakitsu?tab=repositories" class="stat" target="_blank" rel="noopener" title="GitHub 公开仓库数，包含博客与个人介绍仓库">
            <span class="stat-number" id="githubProjectCount" aria-live="polite">9</span>
            <span class="stat-label">项目</span>
          </a>
          <a href="#postsSection" class="stat">
            <span class="stat-number">${posts.length}</span>
            <span class="stat-label">文章</span>
          </a>
          <a href="/categories.html" class="stat">
            <span class="stat-number">${categoriesMap.size}</span>
            <span class="stat-label">分类</span>
          </a>
          <a href="/tags.html" class="stat">
            <span class="stat-number">${tagsMap.size}</span>
            <span class="stat-label">标签</span>
          </a>
        </div>
      </div>

      
      <div class="bento-card bento-tech">
        <div class="bento-card-header">
          <h2 class="bento-card-title">技术栈与工具</h2>
          <span class="bento-card-badge">Stack</span>
        </div>
        <div class="bento-tech-groups">
          <div class="bento-tech-row"><span class="tech-group-label">语言</span><div class="tech-pills"><span class="tech-pill tech-pill-blue">Java</span><span class="tech-pill tech-pill-blue">Python</span><span class="tech-pill tech-pill-blue">TypeScript</span><span class="tech-pill tech-pill-blue">Go</span></div></div>
          <div class="bento-tech-row"><span class="tech-group-label">兴趣</span><div class="tech-pills"><span class="tech-pill tech-pill-teal">AI</span><span class="tech-pill tech-pill-teal">创作</span><span class="tech-pill tech-pill-teal">小工具</span></div></div>
          <div class="bento-tech-row"><span class="tech-group-label">记录</span><div class="tech-pills"><span class="tech-pill tech-pill-purple">GitHub</span><span class="tech-pill tech-pill-purple">Markdown</span></div></div>
        </div>
      </div>


      
      <div class="bento-card bento-focus">
        <div class="bento-card-header">
          <h2 class="bento-card-title">探索与实践领域</h2>
          <span class="bento-card-badge">Focus</span>
        </div>
        <ul class="bento-focus-list">
          <li class="bento-focus-item"><span class="focus-index">01</span><div class="focus-detail"><div class="focus-name">项目记录</div><div class="focus-desc">记录工具、小应用与创作尝试</div></div></li>
          <li class="bento-focus-item"><span class="focus-index">02</span><div class="focus-detail"><div class="focus-name">学习笔记</div><div class="focus-desc">留下解决问题的过程与收获</div></div></li>
          <li class="bento-focus-item"><span class="focus-index">03</span><div class="focus-detail"><div class="focus-name">日常随想</div><div class="focus-desc">收集偶然出现的念头与灵感</div></div></li>
        </ul>
      </div>

      
      <div class="bento-card bento-latest">
        <div class="bento-card-header">
          <h2 class="bento-card-title">近期文章速览</h2>
          <a href="/year-archive.html" class="bento-card-more">归档 →</a>
        </div>
        <div class="bento-latest-list">
${latestPreviewHtml}
        </div>
      </div>
    </div>

    
    <a href="#contentStart" class="hero-scroll-hint" aria-label="向下滚动查看文章">
      <span class="scroll-mouse">
        <span class="scroll-wheel"></span>
      </span>
      <span class="scroll-text">向下滚动探索文章</span>
    </a>
  </div>
</section>

<div id="contentStart"></div><section class="posts-section" id="postsSection"><div class="container"><div class="section-header reveal"><h2 class="section-title">最新文章</h2><a href="/year-archive.html" class="bento-card-more">查看全部归档 (${posts.length}) →</a></div>${postsSectionBodyHtml}</div></section>`;

  fs.writeFileSync(
    path.join(ROOT, 'index.html'),
    renderShell({
      title: 'suakitsu · 个人博客',
      description: 'suakitsu 的个人博客，记录想法、项目与日常。',
      canonicalPath: '/',
      activeNav: 'home',
      mainHtml: indexMainHtml,
      statsText,
      isHome: true
    }),
    'utf8'
  );

  // 3. Build categories.html
  const categoriesBodyHtml =
    categoriesMap.size > 0
      ? `<div class="taxonomy-grid">${Array.from(categoriesMap.entries())
          .map(
            ([cat, list]) =>
              `<div class="taxonomy-card" id="cat-${encodeURIComponent(cat)}"><div class="taxonomy-name"><a href="#cat-${encodeURIComponent(cat)}">${escapeHtml(cat)}</a><span class="taxonomy-count">${list.length} 篇</span></div><ul class="taxonomy-list">${list
                .map(p => `<li><a href="${p.url}">${escapeHtml(p.title)}</a><time datetime="${p.date}">${p.date}</time></li>`)
                .join('')}</ul></div>`
          )
          .join('')}</div>`
      : `<div class="empty-posts"><h2>暂无分类</h2><p>第一篇文章发布后，这里就会有新的记录。</p></div>`;

  fs.writeFileSync(
    path.join(ROOT, 'categories.html'),
    renderShell({
      title: '分类 · suakitsu',
      description: 'suakitsu 的个人博客文章分类。',
      canonicalPath: '/categories.html',
      activeNav: 'categories',
      mainHtml: `<section class="content-page"><div class="container"><h1>分类</h1><p class="page-intro">按主题整理文章，共 ${categoriesMap.size} 个分类。</p>${categoriesBodyHtml}</div></section>`,
      statsText
    }),
    'utf8'
  );

  // 4. Build tags.html
  const tagsBodyHtml =
    tagsMap.size > 0
      ? `<div class="tags-cloud">${Array.from(tagsMap.entries())
          .map(
            ([tag, list]) =>
              `<a href="#tag-${encodeURIComponent(tag)}" class="tag-item"><span>#${escapeHtml(tag)}</span><span class="tag-count">${list.length}</span></a>`
          )
          .join('')}</div><div class="tags-list">${Array.from(tagsMap.entries())
          .map(
            ([tag, list]) =>
              `<div class="tag-section" id="tag-${encodeURIComponent(tag)}"><h2 class="tag-name">#${escapeHtml(tag)}</h2><ul class="tag-posts">${list
                .map(p => `<li><a href="${p.url}">${escapeHtml(p.title)}</a><time datetime="${p.date}">${p.date}</time></li>`)
                .join('')}</ul></div>`
          )
          .join('')}</div>`
      : `<div class="empty-posts"><h2>暂无标签</h2><p>第一篇文章发布后，这里就会有新的记录。</p></div>`;

  fs.writeFileSync(
    path.join(ROOT, 'tags.html'),
    renderShell({
      title: '标签 · suakitsu',
      description: 'suakitsu 的个人博客标签索引。',
      canonicalPath: '/tags.html',
      activeNav: 'tags',
      mainHtml: `<section class="content-page"><div class="container"><h1>标签</h1><p class="page-intro">从关键词找到感兴趣的记录，共 ${tagsMap.size} 个标签。</p>${tagsBodyHtml}</div></section>`,
      statsText
    }),
    'utf8'
  );

  // 5. Build year-archive.html
  const archiveBodyHtml =
    yearsMap.size > 0
      ? `<div class="archive-timeline">${Array.from(yearsMap.entries())
          .map(
            ([yr, list]) =>
              `<div class="archive-year"><h2 class="year-title">${yr}</h2><div class="year-posts">${list
                .map(
                  p =>
                    `<article class="archive-post"><time class="archive-date" datetime="${p.date}">${p.shortDate}</time><div class="archive-content"><h3 class="archive-post-title"><a href="${p.url}">${escapeHtml(p.title)}</a></h3><span class="archive-category">${escapeHtml(p.category)}</span></div></article>`
                )
                .join('')}</div></div>`
          )
          .join('')}</div>`
      : `<div class="empty-posts"><h2>暂无文章</h2><p>第一篇文章发布后，这里就会有新的记录。</p></div>`;

  fs.writeFileSync(
    path.join(ROOT, 'year-archive.html'),
    renderShell({
      title: '归档 · suakitsu',
      description: 'suakitsu 的个人博客时间线归档。',
      canonicalPath: '/year-archive.html',
      activeNav: 'archive',
      mainHtml: `<section class="content-page"><div class="container"><h1>归档</h1><p class="page-intro">把每一次记录留在时间里，共 ${posts.length} 篇文章。</p>${archiveBodyHtml}</div></section>`,
      statsText
    }),
    'utf8'
  );

  // 6. Build about.html & 404.html
  fs.writeFileSync(
    path.join(ROOT, 'about.html'),
    renderShell({
      title: '关于 · suakitsu',
      description: '关于 suakitsu 的个人博客、项目与联系方式。',
      canonicalPath: '/about.html',
      activeNav: 'about',
      mainHtml: `<section class="content-page"><div class="container"><h1>关于</h1><p class="page-intro">你好，我是 suakitsu。</p><div class="about-panel"><div class="profile-card-main"><div class="avatar-wrapper"><img src="/avatar.png" width="80" height="80" alt="suakitsu"></div><div class="profile-card-info"><h2 class="avatar-name">suakitsu</h2><span class="avatar-role">个人博客 · 独立开发与创作记录</span></div></div><p>这里主要记录我日常折腾的开源项目、架构演进笔记与一些随想。常用语言是 Go、Python、Java 和 TypeScript，近期主要探索 AI 视频/图像工作台、可观测网络小工具与桌面端应用。</p><p>如果有任何问题或想法，欢迎在 GitHub 上交流，或通过底部邮箱联系我。</p><a class="about-link" href="https://github.com/suakitsu" target="_blank" rel="noopener">在 GitHub 找到我 →</a></div></div></section>`,
      statsText
    }),
    'utf8'
  );

  fs.writeFileSync(
    path.join(ROOT, '404.html'),
    renderShell({
      title: '页面未找到 · suakitsu',
      description: '页面未找到。',
      canonicalPath: '/404.html',
      activeNav: '',
      mainHtml: `<section class="content-page"><div class="container"><h1>页面未找到</h1><p class="page-intro">这个地址暂时没有内容。</p><a class="hero-link" href="/">返回首页</a></div></section>`,
      statsText
    }),
    'utf8'
  );

  // 7. Build search.json
  const searchData = posts.map(p => ({
    title: p.title,
    url: p.url,
    date: p.date,
    category: p.category,
    tags: p.tags,
    excerpt: p.excerpt,
    content: p.plain
  }));
  fs.writeFileSync(path.join(ROOT, 'search.json'), JSON.stringify(searchData, null, 2), 'utf8');

  console.log(`Built ${posts.length} posts, ${categoriesMap.size} categories, ${tagsMap.size} tags.`);
}

build();
