/* Alice Blue / Cyber Swarm presentation adapted for suakitsu. See LICENSE and NOTICE.md. */
(() => {
  'use strict';
  const Storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const SwarmIntroManager = {
    STORAGE_KEY: 'suakitsu_intro_seen_v1',
    isRunning: false,
    speedMultiplier: 1,
    rafId: null,
    timers: [],
    activeCleanups: [],

    AGENTS_DATA: [
      { name: '布局', color: '#f43f5e' },
      { name: '文字', color: '#0c8ce9' },
      { name: '色彩', color: '#10b981' },
      { name: '组件', color: '#8b5cf6' },
      { name: '灵感', color: '#f59e0b' },
      { name: '代码', color: '#06b6d4' },
      { name: '交互', color: '#ec4899' },
      { name: '动效', color: '#3b82f6' },
      { name: '留白', color: '#14b8a6' },
      { name: '细节', color: '#a855f7' },
      { name: '检查', color: '#22c55e' },
      { name: '发布', color: '#fb7185' }
    ],

    easeOutQuart(t) {
      return 1 - Math.pow(1 - t, 4);
    },

    easeInOutQuart(t) {
      return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    },

    ICONS: {
      arrow: (color) => `
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <path d="M4.5 3.5L11.5 20L14.2 13.8L20.5 11.2L4.5 3.5Z" fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>`,
      crosshair: (color) => `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path d="M12 3V21M3 12H21" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
          <path d="M12 3V21M3 12H21" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
          <rect x="9.5" y="9.5" width="5" height="5" fill="none" stroke="${color}" stroke-width="1.5"/>
        </svg>`,
      ibeam: (color) => `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path d="M8 4H16M8 20H16M12 4V20" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
          <path d="M8 4H16M8 20H16M12 4V20" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
        </svg>`,
      hand: (color) => `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
          <path d="M9 11V6a1.5 1.5 0 0 1 3 0v4m0-3a1.5 1.5 0 0 1 3 0v3m0-2a1.5 1.5 0 0 1 3 0v5a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.2 13.8a1.5 1.5 0 0 1 2.3-1.9L9 14V11Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`
    },

    init() {
      const replayBtn = document.getElementById('swarmReplayBtn');
      const isHome = document.querySelector('.hero') !== null;

      if (replayBtn) {
        replayBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (!isHome) {
            window.location.href = '/?intro=1';
            return;
          }
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          this.start(true);
        });
      }

      if (!isHome) {
        document.documentElement.classList.remove('swarm-intro-preparing');
        return;
      }

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const urlParams = new URLSearchParams(window.location.search);
      const forceIntro = urlParams.get('intro') === '1';
      const seen = Storage.get(this.STORAGE_KEY);

      if (!prefersReducedMotion && (!seen || forceIntro)) {
        if (forceIntro && window.history.replaceState) {
          urlParams.delete('intro');
          const newSearch = urlParams.toString();
          window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash);
        }
        this.start(false);
      } else {
        document.documentElement.classList.remove('swarm-intro-preparing');
      }
    },

    collectTargets() {
      const structuralTasks = [];
      const detailTasks = [];
      const vh = window.innerHeight;

      const createTask = (el, type, metaLabel, parentTask = null) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return null;

        if (rect.top > vh - 10 || rect.bottom < 0) return null;
        let resolveDone;
        const donePromise = new Promise((res) => {
          resolveDone = res;
        });
        return {
          el,
          type,
          metaLabel,
          cachedRect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          parentPromise: parentTask ? parentTask.donePromise : null,
          donePromise,
          markDone: resolveDone
        };
      };

      const pushStructural = (el, type, metaLabel) => {
        const t = createTask(el, type, metaLabel, null);
        if (t) structuralTasks.push(t);
        return t;
      };

      const pushDetail = (el, type, metaLabel, parentTask = null) => {
        const t = createTask(el, type, metaLabel, parentTask);
        if (t) detailTasks.push(t);
        return t;
      };

      const introCardTask = pushStructural(document.querySelector('.bento-intro'), 'box', 'Intro-Card');
      const profileCardTask = pushStructural(document.querySelector('.bento-profile'), 'box', 'Profile-Card');
      const techCardTask = pushStructural(document.querySelector('.bento-tech'), 'box', 'Stack-Card');
      const focusCardTask = pushStructural(document.querySelector('.bento-focus'), 'box', 'Focus-Card');
      const latestCardTask = pushStructural(document.querySelector('.bento-latest'), 'box', 'Recent-Card');

      pushStructural(document.querySelector('.navbar .logo'), 'place', 'Logo');
      document.querySelectorAll('.navbar .nav-link').forEach((link, idx) => {
        pushStructural(link, 'place', `Nav-${idx + 1}`);
      });

      pushStructural(document.getElementById('searchToggle'), 'place', 'Search');
      pushStructural(document.getElementById('themeToggle'), 'place', 'Theme');
      pushStructural(document.getElementById('menuToggle'), 'place', 'Menu');


      pushDetail(document.querySelector('.bento-intro .hero-badge'), 'place', 'Badge', introCardTask);
      pushDetail(document.querySelector('.bento-intro .hero-location'), 'place', 'Location', introCardTask);
      pushDetail(document.querySelector('.bento-intro .hero-greeting'), 'type', 'Greeting', introCardTask);
      pushDetail(document.querySelector('.bento-intro .hero-name'), 'type', 'Heading', introCardTask);
      pushDetail(document.querySelector('.bento-intro .hero-subtitle-pill'), 'place', 'Tagline', introCardTask);
      pushDetail(document.querySelector('.bento-intro .hero-description'), 'type', 'Bio', introCardTask);
      document.querySelectorAll('.bento-intro .hero-links .hero-link').forEach((btn, idx) => {
        pushDetail(btn, 'place', `CTA-${idx + 1}`, introCardTask);
      });

      pushDetail(document.querySelector('.bento-profile .avatar-wrapper'), 'box', 'Avatar', profileCardTask);
      pushDetail(document.querySelector('.bento-profile .avatar-name'), 'type', 'Name', profileCardTask);
      pushDetail(document.querySelector('.bento-profile .avatar-role'), 'type', 'Role', profileCardTask);
      pushDetail(document.querySelector('.bento-profile .avatar-tags'), 'place', 'Skills', profileCardTask);
      document.querySelectorAll('.bento-profile .avatar-stats .stat').forEach((stat, idx) => {
        pushDetail(stat, 'place', `Stat-${idx + 1}`, profileCardTask);
      });

      pushDetail(document.querySelector('.bento-tech .bento-card-header'), 'place', 'Header', techCardTask);
      document.querySelectorAll('.bento-tech .bento-tech-row').forEach((row, idx) => {
        pushDetail(row, 'place', `Tech-${idx + 1}`, techCardTask);
      });

      pushDetail(document.querySelector('.bento-focus .bento-card-header'), 'place', 'Header', focusCardTask);
      document.querySelectorAll('.bento-focus .bento-focus-item').forEach((item, idx) => {
        pushDetail(item, 'place', `Focus-${idx + 1}`, focusCardTask);
      });

      pushDetail(document.querySelector('.bento-latest .bento-card-header'), 'place', 'Header', latestCardTask);
      document.querySelectorAll('.bento-latest .bento-latest-item').forEach((item, idx) => {
        pushDetail(item, 'place', `Post-${idx + 1}`, latestCardTask);
      });

      pushDetail(document.querySelector('.hero-scroll-hint'), 'place', 'Scroll-Hint', null);

      return [...structuralTasks, ...detailTasks];
    },

    prepareAllPostsGridImmediately() {
      const skeletonGrid = document.getElementById('skeletonGrid');
      const postsGrid = document.getElementById('postsGrid');
      if (skeletonGrid && postsGrid) {
        skeletonGrid.style.display = 'none';
        postsGrid.style.display = 'grid';
        postsGrid.style.opacity = '1';
      }

      document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger').forEach((el) => {
        el.classList.add('revealed');
      });
    },

    isAlive(run) {
      return this.isRunning && this.runId === run;
    },

    start(isReplay = false) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.cleanup(true);
        return;
      }
      if (this.isRunning) {
        this.cleanup(true);
      }
      this.runId = (this.runId || 0) + 1;
      const run = this.runId;
      this.isRunning = true;
      this.previousFocus = document.activeElement;
      this.safetyTimer = setTimeout(() => this.cleanup(true), 30000);
      this.resizeHandler = () => this.cleanup(true);
      window.addEventListener('resize', this.resizeHandler, { once: true });

      const replayBtn = document.getElementById('swarmReplayBtn');
      if (replayBtn) {
        replayBtn.classList.remove('is-tilted', 'is-springing');
        replayBtn.classList.add('swarm-replay-pending');
      }
      this.speedMultiplier = 1;
      Storage.set(this.STORAGE_KEY, '1');

      document.documentElement.classList.add('swarm-running');

      this.prepareAllPostsGridImmediately();

      const tasks = this.collectTargets();
      tasks.forEach((task) => {
        if (task.type === 'type') {
          if (!task.el.dataset.swarmOrigText) {
            task.el.dataset.swarmOrigText = task.el.textContent.trim();
          }
          task.origText = task.el.dataset.swarmOrigText;

          task.el.style.minHeight = `${Math.round(task.cachedRect.height)}px`;
          task.el.style.minWidth = `${Math.round(task.cachedRect.width)}px`;
          task.el.textContent = '';
          task.el.classList.add('swarm-target-hidden');
        } else {
          task.el.classList.add('swarm-target-hidden');
        }
      });

      document.documentElement.classList.remove('swarm-intro-preparing');

      this.buildStage(tasks.length);

      this.createAgents();

      this.escHandler = (e) => {
        if (e.key === 'Escape') {
          this.skip();
        }
      };
      window.addEventListener('keydown', this.escHandler);

      this.runTimeline(tasks, run).catch(() => this.cleanup(true));
    },

    buildStage(totalLayers) {
      this.stage = document.createElement('div');
      this.stage.className = 'swarm-stage';
      this.stage.setAttribute('aria-hidden', 'true');

      this.backdrop = document.createElement('div');
      this.backdrop.className = 'swarm-backdrop';
      this.stage.appendChild(this.backdrop);

      this.centerBadge = document.createElement('div');
      this.centerBadge.className = 'swarm-center-badge';
      const avatarImg = document.querySelector('.avatar-wrapper img');
      const avatarSrc = avatarImg ? avatarImg.src : '/avatar.png';
      this.centerBadge.innerHTML = `<img src="${avatarSrc}" alt="suakitsu">`;
      this.stage.appendChild(this.centerBadge);

      this.guideV = document.createElement('div');
      this.guideV.className = 'swarm-guide-line guide-v';
      this.guideH1 = document.createElement('div');
      this.guideH1.className = 'swarm-guide-line guide-h';
      this.guideH2 = document.createElement('div');
      this.guideH2.className = 'swarm-guide-line guide-h';
      this.stage.appendChild(this.guideV);
      this.stage.appendChild(this.guideH1);
      this.stage.appendChild(this.guideH2);

      document.body.appendChild(this.stage);

      this.hud = document.createElement('div');
      this.hud.className = 'swarm-hud';
      this.hud.setAttribute('role', 'region');
      this.hud.setAttribute('aria-label', '首页构建动画控制');
      const dotColors = ['#38bdf8', '#34d399', '#fbbf24', '#f43f5e', '#a855f7'];
      const dotsHtml = dotColors
        .map((c) => `<span class="swarm-hud-dot" style="background:${c}"></span>`)
        .join('');

      this.hud.innerHTML = `
        <div class="swarm-hud-dots">${dotsHtml}</div>
        <div class="swarm-hud-status" id="swarmHudStatus">正在搭建首页...</div>
        <div class="swarm-hud-progress" id="swarmHudProgressWrap">
          <div class="swarm-hud-progress-bar" id="swarmHudBar"></div>
        </div>
        <div class="swarm-hud-actions">
          <button type="button" class="swarm-hud-btn" id="swarmSpeedBtn" title="切换构建倍速" aria-label="切换构建倍速">1x</button>
          <button type="button" class="swarm-hud-btn is-primary" id="swarmHudReplayBtn" style="display:none;">↻ 重播</button>
          <button type="button" class="swarm-hud-btn btn-close" id="swarmSkipBtn" title="跳过动画 (Esc)" aria-label="跳过动画">✕</button>
        </div>
      `;
      document.body.appendChild(this.hud);

      this.hudStatus = this.hud.querySelector('#swarmHudStatus');
      this.hudBar = this.hud.querySelector('#swarmHudBar');
      this.hudProgressWrap = this.hud.querySelector('#swarmHudProgressWrap');
      this.speedBtn = this.hud.querySelector('#swarmSpeedBtn');
      this.hudReplayBtn = this.hud.querySelector('#swarmHudReplayBtn');
      this.skipBtn = this.hud.querySelector('#swarmSkipBtn');

      this.speedBtn.addEventListener('click', () => {
        this.speedMultiplier = this.speedMultiplier === 1 ? 2 : 1;
        this.speedBtn.textContent = `${this.speedMultiplier}x`;
      });

      this.hudReplayBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          this.start(true);
      });

      this.skipBtn.addEventListener('click', () => {
        this.skip();
      });

      requestAnimationFrame(() => {
        if (this.hud) this.hud.classList.add('is-visible');
        if (this.centerBadge) this.centerBadge.classList.add('is-visible');
      });
    },

    createAgents() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = vw * 0.5;
      const cy = vh * 0.46;

      this.agents = this.AGENTS_DATA.map((item, index) => {
        const angle = (index / this.AGENTS_DATA.length) * Math.PI * 2;
        const startDist = Math.max(vw, vh) * (0.42 + (index % 3) * 0.12);
        const startX = cx + Math.cos(angle) * startDist;
        const startY = cy + Math.sin(angle) * startDist;

        const el = document.createElement('div');
        el.className = 'swarm-cursor';
        el.style.setProperty('--agent-color', item.color);
        el.innerHTML = `
          <div class="swarm-cursor-icon">${this.ICONS.arrow(item.color)}</div>
          <div class="swarm-cursor-tag">
            <span>${item.name}</span>
            <span class="swarm-cursor-tag-meta" style="display:none;"></span>
          </div>
        `;
        this.stage.appendChild(el);

        const agent = {
          id: index,
          name: item.name,
          color: item.color,
          el,
          iconEl: el.querySelector('.swarm-cursor-icon'),
          metaEl: el.querySelector('.swarm-cursor-tag-meta'),
          x: startX,
          y: startY,
          prevX: startX,
          prevY: startY,
          angle,
          orbitRadius: 44 + (index % 4) * 22,
          orbitSpeed: (index % 2 === 0 ? 1 : -1) * (2.5 + (index % 3) * 0.45),
          speedFactor: 0.88 + (index % 4) * 0.1,
          tool: 'arrow',
          busy: false,
          retired: false
        };

        this.setAgentPos(agent, startX, startY);
        return agent;
      });
    },

    setAgentPos(agent, x, y) {
      if (agent.retired) return;
      agent.prevX = agent.x;
      agent.prevY = agent.y;
      agent.x = x;
      agent.y = y;
      agent.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    },

    setAgentTool(agent, tool, metaText = '') {
      if (agent.retired) return;
      if (agent.tool !== tool) {
        agent.tool = tool;
        const renderer = this.ICONS[tool] || this.ICONS.arrow;
        agent.iconEl.innerHTML = renderer(agent.color);
      }
      if (metaText) {
        agent.metaEl.textContent = metaText;
        agent.metaEl.style.display = 'inline';
      } else {
        agent.metaEl.style.display = 'none';
      }
    },

    spawnRipple(x, y, color) {
      if (!this.stage) return;
      const r = document.createElement('div');
      r.className = 'swarm-ripple';
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      r.style.setProperty('--ripple-color', color);
      this.stage.appendChild(r);
      setTimeout(() => r.remove(), 600);
    },

    moveAgentTo(agent, targetX, targetY, durationMs, onUpdate, easingType = 'outQuart') {
      const run = this.runId;
      return new Promise((resolve) => {
        if (agent.retired) return resolve();
        const startX = agent.x;
        const startY = agent.y;
        const dx = targetX - startX;
        const dy = targetY - startY;
        const ctrlX = startX + dx * 0.46 - dy * 0.14;
        const ctrlY = startY + dy * 0.46 + dx * 0.14;

        let elapsed = 0;
        let lastTime = performance.now();
        const actualDuration = Math.max(20, durationMs / (agent.speedFactor || 1));

        const step = (now) => {
          if (!this.isAlive(run) || agent.retired) return resolve();
          const dt = (now - lastTime) * this.speedMultiplier;
          lastTime = now;
          elapsed += dt;

          const t = Math.min(1, elapsed / actualDuration);

          const ease =
            easingType === 'linear'
              ? t
              : easingType === 'inOutQuart'
              ? this.easeInOutQuart(t)
              : this.easeOutQuart(t);

          const inv = 1 - ease;
          const curX = inv * inv * startX + 2 * inv * ease * ctrlX + ease * ease * targetX;
          const curY = inv * inv * startY + 2 * inv * ease * ctrlY + ease * ease * targetY;

          this.setAgentPos(agent, curX, curY);
          if (onUpdate) onUpdate(ease, curX, curY, t);

          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };

        requestAnimationFrame(step);
      });
    },

    async retireAgent(agent) {
      if (!this.isRunning || agent.retired) return;
      this.setAgentTool(agent, 'arrow');

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const exitX = vw + 75 + (agent.id % 4) * 32;
      const exitY = vh + 65 + Math.floor(agent.id / 4) * 28;
      if (agent.y > vh + 120) {
        agent.y = vh + 40;
      }

      await this.moveAgentTo(
        agent,
        exitX,
        exitY,
        560 + (agent.id % 3) * 70,
        (ease) => {
          const alpha = Math.max(0, 1 - Math.pow(ease, 2));
          agent.el.style.opacity = alpha.toFixed(2);
        },
        'outQuart'
      );

      agent.retired = true;
      if (agent.el) agent.el.remove();
    },

    wait(ms) {
      const run = this.runId;
      return new Promise((resolve) => {
        let elapsed = 0;
        let last = performance.now();
        const tick = (now) => {
          if (!this.isAlive(run)) return resolve();
          elapsed += (now - last) * this.speedMultiplier;
          last = now;
          if (elapsed >= ms) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },

    async runTimeline(tasks, run) {
      const agents = this.agents;
      const startTime = performance.now();
      const totalLayers = Math.max(1, tasks.length);
      let completedLayers = 0;

      const updateHudProgress = () => {
        if (!this.hudStatus || !this.hudBar) return;
        const pct = Math.min(100, Math.round((completedLayers / totalLayers) * 100));
        this.hudStatus.innerHTML = `<strong>${agents.length} 个光标</strong> · ${completedLayers} / ${totalLayers} 个组件`;
        this.hudBar.style.transform = `scaleX(${pct / 100})`;
      };



      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = vw * 0.5;
      const cy = vh * 0.46;

      await new Promise((resolve) => {
        let elapsed = 0;
        let last = performance.now();
        const duration = 680;

        const vortexStep = (now) => {
          if (!this.isAlive(run)) return resolve();
          const dt = (now - last) * this.speedMultiplier;
          last = now;
          elapsed += dt;
          const progress = Math.min(1, elapsed / duration);
          const ease = this.easeOutQuart(progress);

          agents.forEach((agent) => {
            const currentAngle = agent.angle + progress * agent.orbitSpeed * 2.1;
            const startR = Math.max(vw, vh) * 0.44;
            const r = startR * (1 - ease) + agent.orbitRadius * ease;
            const x = cx + Math.cos(currentAngle) * r;
            const y = cy + Math.sin(currentAngle) * r * 0.78;
            this.setAgentPos(agent, x, y);
          });

          if (this.hudBar) {
            this.hudBar.style.transform = `scaleX(${progress * .1})`;
          }

          if (progress < 1) {
            requestAnimationFrame(vortexStep);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(vortexStep);
      });

      if (!this.isAlive(run)) return;



      this.centerBadge.classList.remove('is-visible');
      this.centerBadge.classList.add('is-dispersing');
      this.backdrop.classList.add('is-fading');
      updateHudProgress();

      const contentGridEl =
        document.querySelector('.bento-grid') ||
        document.querySelector('.hero-grid') ||
        document.querySelector('.hero .container') ||
        document.body;
      const navbarEl = document.querySelector('.navbar');
      const gridRect = contentGridEl.getBoundingClientRect();
      const navBottom = navbarEl ? Math.round(navbarEl.getBoundingClientRect().bottom) : 56;

      const abLeft = Math.round(gridRect.left);
      const abTop = Math.round(gridRect.top);
      const abWidth = Math.round(gridRect.width);
      const abHeight = Math.round(gridRect.height);

      this.guideV.style.left = `${abLeft}px`;
      this.guideH1.style.top = `${navBottom}px`;
      this.guideH2.style.top = `${abTop + abHeight}px`;
      this.guideV.classList.add('is-active');
      this.guideH1.classList.add('is-active');
      this.guideH2.classList.add('is-active');

      const artboard = document.createElement('div');
      artboard.className = 'swarm-wireframe';
      artboard.style.setProperty('--wf-color', '#0c8ce9');
      artboard.innerHTML = `
        <span class="swarm-wf-handle-bl"></span>
        <span class="swarm-wf-handle-br"></span>
        <span class="swarm-wf-size" id="artboardSizeTag">0 × 0</span>
      `;
      this.stage.appendChild(artboard);
      const artboardTag = artboard.querySelector('#artboardSizeTag');

      const syncArtboardOnScroll = () => {
        if (!this.isAlive(run) || !artboard.isConnected) return;
        const r = contentGridEl.getBoundingClientRect();
        artboard.style.left = `${Math.round(r.left)}px`;
        artboard.style.top = `${Math.round(r.top)}px`;
        artboard.style.width = `${Math.round(r.width)}px`;
        artboard.style.height = `${Math.round(r.height)}px`;
      };

      const buildArtboardTask = async (leadAgent) => {
        leadAgent.busy = true;
        this.setAgentTool(leadAgent, 'crosshair', 'Artboard');
        await this.moveAgentTo(leadAgent, abLeft, abTop, 240);
        if (!this.isAlive(run)) return;
        await this.moveAgentTo(leadAgent, abLeft + abWidth, abTop + abHeight, 360, (ease) => {
          const curRect = contentGridEl.getBoundingClientRect();
          const curL = Math.round(curRect.left);
          const curT = Math.round(curRect.top);
          const curW = Math.max(20, Math.round(curRect.width * ease));
          const curH = Math.max(20, Math.round(curRect.height * ease));
          artboard.style.left = `${curL}px`;
          artboard.style.top = `${curT}px`;
          artboard.style.width = `${curW}px`;
          artboard.style.height = `${curH}px`;
          if (artboardTag) artboardTag.textContent = `${curW} × ${curH}`;
        });
        this.spawnRipple(abLeft + abWidth, abTop + abHeight, leadAgent.color);
        leadAgent.busy = false;
        this.setAgentTool(leadAgent, 'arrow');
        artboard.style.background = 'transparent';
        artboard.style.borderColor = 'rgba(12, 140, 233, 0.28)';
        syncArtboardOnScroll();
      };

      const executeTask = async (agent, task, isFirstTask = false) => {
        if (!this.isAlive(run)) {
          if (task.markDone) task.markDone();
          return;
        }
        agent.busy = true;

        const extraFlight = isFirstTask ? (agent.id % 6) * 42 : 0;

        const liveRect = task.el.getBoundingClientRect();
        const initRect = liveRect.width >= 4 ? liveRect : (task.cachedRect || liveRect);
        if (initRect.top >= 0 && initRect.top <= window.innerHeight && this.guideV && this.guideH2) {
          this.guideV.style.left = `${Math.round(initRect.left)}px`;
          this.guideH2.style.top = `${Math.round(initRect.bottom)}px`;
        }

        if (task.type === 'box') {

          this.setAgentTool(agent, 'crosshair', task.metaLabel);
          await this.moveAgentTo(agent, Math.round(initRect.left), Math.round(initRect.top), 290 + extraFlight);
          if (task.parentPromise) await task.parentPromise;
          if (!this.isAlive(run)) {
            if (task.markDone) task.markDone();
            return;
          }

          const wf = document.createElement('div');
          wf.className = 'swarm-wireframe';
          wf.style.setProperty('--wf-color', agent.color);
          wf.innerHTML = `
            <span class="swarm-wf-handle-bl"></span>
            <span class="swarm-wf-handle-br"></span>
            <span class="swarm-wf-size">0 × 0</span>
          `;
          this.stage.appendChild(wf);
          const sizeLabel = wf.querySelector('.swarm-wf-size');

          task.el.classList.add('swarm-target-building');
          task.el.classList.remove('swarm-target-hidden');

          const targetRect = task.el.getBoundingClientRect();
          await this.moveAgentTo(
            agent,
            Math.round(targetRect.right),
            Math.round(targetRect.bottom),
            380,
            (ease) => {

              const curRect = task.el.getBoundingClientRect();
              const l = Math.round(curRect.left);
              const t = Math.round(curRect.top);
              const w = Math.max(6, Math.round(curRect.width * ease));
              const h = Math.max(6, Math.round(curRect.height * ease));
              wf.style.left = `${l}px`;
              wf.style.top = `${t}px`;
              wf.style.width = `${w}px`;
              wf.style.height = `${h}px`;
              sizeLabel.textContent = `${w} × ${h}`;

              const clipRight = Math.max(0, 100 - ease * 100).toFixed(1);
              const clipBottom = Math.max(0, 100 - ease * 100).toFixed(1);
              task.el.style.clipPath = `inset(0 ${clipRight}% ${clipBottom}% 0)`;
              task.el.style.opacity = String(Math.min(1, ease * 1.2));

              if (curRect.top >= 0 && curRect.top <= window.innerHeight && this.guideH2) {
                this.guideV.style.left = `${l}px`;
                this.guideH2.style.top = `${t + h}px`;
              }
            },
            'outQuart'
          );

          task.el.style.clipPath = '';
          task.el.style.opacity = '';
          const endRect = task.el.getBoundingClientRect();
          this.spawnRipple(Math.round(endRect.right), Math.round(endRect.bottom), agent.color);

          wf.style.opacity = '0';
          setTimeout(() => wf.remove(), 240);
        } else if (task.type === 'type') {

          this.setAgentTool(agent, 'ibeam', 'Typing');
          await this.moveAgentTo(
            agent,
            Math.round(initRect.left + 4),
            Math.round(initRect.top + initRect.height * 0.5),
            270 + extraFlight
          );
          if (task.parentPromise) await task.parentPromise;
          if (!this.isAlive(run)) {
            if (task.markDone) task.markDone();
            return;
          }

          task.el.classList.remove('swarm-target-hidden');
          task.el.classList.add('swarm-text-highlight');
          const fullText = task.origText || '';
          const len = fullText.length;
          const typeDuration = Math.min(1350, Math.max(400, len * 42));

          const curRect = task.el.getBoundingClientRect();
          const spanWidth = Math.max(curRect.width, task.cachedRect ? task.cachedRect.width : 48);
          await this.moveAgentTo(
            agent,
            Math.round(curRect.left + Math.min(spanWidth, Math.max(48, len * 13))),
            Math.round(curRect.top + curRect.height * 0.5),
            typeDuration,
            (_ease, _cx, _cy, rawT) => {
              const charCount = Math.max(1, Math.round(len * rawT));
              task.el.textContent = fullText.slice(0, charCount);
            },
            'outQuart'
          );

          task.el.textContent = fullText;
          task.el.style.minHeight = '';
          task.el.style.minWidth = '';
          setTimeout(() => {
            task.el.classList.remove('swarm-text-highlight');
          }, 260);
        } else {

          this.setAgentTool(agent, 'hand', task.metaLabel);
          const targetX = Math.round(initRect.left + initRect.width * 0.5);
          const targetY = Math.round(initRect.top + initRect.height * 0.5);
          await this.moveAgentTo(agent, targetX, targetY, 260 + extraFlight);
          if (task.parentPromise) await task.parentPromise;
          if (!this.isAlive(run)) {
            if (task.markDone) task.markDone();
            return;
          }

          const curRect = task.el.getBoundingClientRect();
          const wf = document.createElement('div');
          wf.className = 'swarm-wireframe';
          wf.style.setProperty('--wf-color', agent.color);
          wf.style.left = `${Math.round(curRect.left)}px`;
          wf.style.top = `${Math.round(curRect.top)}px`;
          wf.style.width = `${Math.round(curRect.width)}px`;
          wf.style.height = `${Math.round(curRect.height)}px`;
          wf.innerHTML = `<span class="swarm-wf-size">${Math.round(curRect.width)} × ${Math.round(curRect.height)}</span>`;
          this.stage.appendChild(wf);

          agent.el.classList.add('is-clicking');
          this.spawnRipple(Math.round(curRect.left + curRect.width * 0.5), Math.round(curRect.top + curRect.height * 0.5), agent.color);
          task.el.classList.add('swarm-target-building');
          task.el.classList.remove('swarm-target-hidden');

          await this.wait(140);
          agent.el.classList.remove('is-clicking');
          wf.style.opacity = '0';
          setTimeout(() => wf.remove(), 220);
        }

        if (task.markDone) task.markDone();
        this.setAgentTool(agent, 'arrow');
        agent.busy = false;
        completedLayers++;
        updateHudProgress();
      };

      const taskQueue = [...tasks];
      const workerPromises = agents.map(async (agent, idx) => {
        let isFirst = true;
        if (idx === 1) {

          await buildArtboardTask(agent);
          isFirst = false;
        }
        while (this.isAlive(run) && taskQueue.length > 0) {
          const nextTask = taskQueue.shift();
          if (!nextTask) break;
          await executeTask(agent, nextTask, isFirst);
          isFirst = false;
        }

        await this.retireAgent(agent);
      });

      await Promise.all(workerPromises);

      if (!this.isAlive(run)) return;



      if (this.scrollSyncCleanup) {
        this.scrollSyncCleanup();
        this.scrollSyncCleanup = null;
      }
      artboard.style.opacity = '0';
      this.guideV.classList.remove('is-active');
      this.guideH1.classList.remove('is-active');
      this.guideH2.classList.remove('is-active');



      await this.playFinale(run);
      if (!this.isAlive(run)) return;

      const totalSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
      if (this.hudStatus) {
        this.hudStatus.innerHTML = `首页已就绪 · ${totalSeconds} 秒`;
      }

      if (this.hudProgressWrap) {
        const bar = this.hudProgressWrap;
        bar.classList.add('is-collapsed');
        setTimeout(() => {
          bar.style.display = 'none';
        }, 340);
      }
      if (this.speedBtn) {
        this.speedBtn.style.display = 'none';
      }
      if (this.hudReplayBtn) {
        this.hudReplayBtn.style.display = 'inline-flex';
      }

      await this.wait(300);
      if (!this.isAlive(run)) return;

      if (this.stage) {
        this.stage.remove();
        this.stage = null;
      }
      document.documentElement.classList.remove('swarm-running');

      this.autoHideTimer = setTimeout(() => {
        this.cleanup(false);
      }, 3800);
    },


    async playFinale(run) {
      const replayBtn = document.getElementById('swarmReplayBtn');
      if (!this.stage || !replayBtn) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const color = '#f43f5e';

      const startX = vw + 90;
      const startY = vh * 0.62;

      const el = document.createElement('div');
      el.className = 'swarm-cursor';
      el.style.setProperty('--agent-color', color);
      el.innerHTML = `
        <div class="swarm-cursor-icon">${this.ICONS.arrow(color)}</div>
        <div class="swarm-cursor-tag"><span>灵感</span><span class="swarm-cursor-tag-meta" style="display:none;"></span></div>
      `;
      el.style.opacity = '0';
      this.stage.appendChild(el);

      const agent = {
        id: 12,
        name: '灵感',
        color,
        el,
        iconEl: el.querySelector('.swarm-cursor-icon'),
        metaEl: el.querySelector('.swarm-cursor-tag-meta'),
        x: startX,
        y: startY,
        prevX: startX,
        prevY: startY,
        angle: 0,
        orbitRadius: 0,
        orbitSpeed: 0,
        speedFactor: 1.06,
        tool: 'arrow',
        busy: false,
        retired: false
      };
      this.setAgentPos(agent, agent.x, agent.y);

      const carry = document.createElement('div');
      carry.className = 'swarm-carry-icon';
      carry.innerHTML = replayBtn.innerHTML;
      this.stage.appendChild(carry);
      const placeCarry = (x, y, rot, scale, alpha = 1) => {
        carry.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${rot}deg) scale(${scale})`;
        carry.style.opacity = String(alpha);
      };
      placeCarry(agent.x + 16, agent.y + 6, 22, 1.05);

      const btnRect = replayBtn.getBoundingClientRect();
      const btnCx = btnRect.left + btnRect.width * 0.5;
      const btnCy = btnRect.top + btnRect.height * 0.5;

      requestAnimationFrame(() => {
        if (el.isConnected) el.style.opacity = '1';
      });
      await this.wait(90);
      if (!this.isAlive(run)) {
        carry.remove();
        el.remove();
        return;
      }

      await this.moveAgentTo(
        agent,
        Math.round(btnCx + 46),
        Math.round(btnCy + 12),
        640,
        (ease, x, y) => placeCarry(x + 16, y + 6, 22, 1.05),
        'inOutQuart'
      );
      if (!this.isAlive(run)) {
        carry.remove();
        el.remove();
        return;
      }

      const fromX = agent.x + 16;
      const fromY = agent.y + 6;
      await new Promise((resolve) => {
        const duration = 230;
        const t0 = performance.now();
        const step = (now) => {
          if (!this.isAlive(run)) return resolve();
          const t = Math.min(1, (now - t0) / duration);
          const ease = this.easeOutQuart(t);
          placeCarry(
            fromX + (btnCx - fromX) * ease,
            fromY + (btnCy - fromY) * ease,
            22,
            1.05 - 0.35 * ease,
            1 - ease
          );
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      carry.remove();
      if (!this.isAlive(run)) return;

      replayBtn.classList.remove('swarm-replay-pending');
      replayBtn.classList.add('is-tilted');

      await this.moveAgentTo(
        agent,
        Math.round(btnCx + 150),
        Math.round(btnCy + 66),
        430,
        null,
        'inOutQuart'
      );
      if (!this.isAlive(run)) return;
      await this.wait(120);
      if (!this.isAlive(run)) return;

      await this.moveAgentTo(agent, Math.round(btnCx + 13), Math.round(btnCy + 2), 190, null, 'inOutQuart');
      if (!this.isAlive(run)) return;
      el.classList.add('is-clicking');
      this.spawnRipple(Math.round(btnCx), Math.round(btnCy), color);
      replayBtn.classList.add('is-springing');
      replayBtn.classList.remove('is-tilted');

      await this.moveAgentTo(agent, Math.round(btnCx + 112), Math.round(btnCy + 96), 240, null, 'outQuart');
      el.classList.remove('is-clicking');
      if (!this.isAlive(run)) return;
      setTimeout(() => replayBtn.classList.remove('is-springing'), 420);

      await this.wait(340);
      if (!this.isAlive(run)) return;

      this.setAgentTool(agent, 'arrow');
      await this.moveAgentTo(
        agent,
        vw + 80,
        vh + 80,
        520,
        (ease) => {
          el.style.opacity = Math.max(0, 1 - Math.pow(ease, 2)).toFixed(2);
        },
        'outQuart'
      );
      agent.retired = true;
      el.remove();
    },

    skip() {
      this.cleanup(true);
    },

    cleanup(immediate = true) {
      clearTimeout(this.safetyTimer);
      if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
      if (this.hud?.contains(document.activeElement) && this.previousFocus?.isConnected) {
        this.previousFocus.focus({ preventScroll: true });
      }
      this.isRunning = false;
      if (this.scrollSyncCleanup) {
        this.scrollSyncCleanup();
        this.scrollSyncCleanup = null;
      }
      if (this.autoHideTimer) {
        clearTimeout(this.autoHideTimer);
        this.autoHideTimer = null;
      }
      if (this.escHandler) {
        window.removeEventListener('keydown', this.escHandler);
        this.escHandler = null;
      }

      document.documentElement.classList.remove('swarm-intro-preparing', 'swarm-running');

      const replayBtn = document.getElementById('swarmReplayBtn');
      if (replayBtn) {
        replayBtn.classList.remove('swarm-replay-pending', 'is-tilted', 'is-springing');
      }

      document.querySelectorAll('.swarm-target-hidden, .swarm-target-building, .swarm-text-highlight, [data-swarm-orig-text]').forEach((el) => {
        el.classList.remove('swarm-target-hidden', 'swarm-target-building', 'swarm-text-highlight');
        el.style.opacity = '';
        el.style.transform = '';
        el.style.transformOrigin = '';
        el.style.clipPath = '';
        el.style.minHeight = '';
        el.style.minWidth = '';
        if (el.dataset.swarmOrigText) {
          el.textContent = el.dataset.swarmOrigText;
        }
      });

      this.prepareAllPostsGridImmediately();

      if (this.stage) {
        this.stage.remove();
        this.stage = null;
      }

      if (this.hud) {
        if (immediate) {
          this.hud.remove();
          this.hud = null;
        } else {
          const hudRef = this.hud;
          this.hud = null;
          hudRef.classList.remove('is-visible');
          setTimeout(() => hudRef.remove(), 380);
        }
      }
    }
  };


  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function initControls() {
    const themeButton = document.getElementById('themeToggle');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (value) => {
      document.documentElement.dataset.theme = value;
      themeButton.setAttribute('aria-pressed', String(value === 'dark'));
      document.querySelector('meta[name="theme-color"]').content = value === 'dark' ? '#0f172a' : '#f0f8ff';
    };
    applyTheme(Storage.get('suakitsu-theme') || (systemTheme.matches ? 'dark' : 'light'));
    themeButton.addEventListener('click', () => {
      const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      Storage.set('suakitsu-theme', value);
      applyTheme(value);
    });
    systemTheme.addEventListener('change', () => {
      if (!Storage.get('suakitsu-theme')) applyTheme(systemTheme.matches ? 'dark' : 'light');
    });

    const menuButton = document.getElementById('menuToggle');
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');
    const setMenu = (open) => {
      menu.classList.toggle('active', open);
      overlay.classList.toggle('active', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.textContent = open ? '✕' : '☰';
    };
    menuButton.addEventListener('click', () => setMenu(!menu.classList.contains('active')));
    overlay.addEventListener('click', () => setMenu(false));
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menu.classList.contains('active')) { setMenu(false); menuButton.focus(); }
    });

    const dialog = document.getElementById('searchModal');
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    const showSearch = () => { SwarmIntroManager.cleanup(true); setMenu(false); dialog.showModal(); input.focus(); };
    document.getElementById('searchToggle').addEventListener('click', showSearch);
    document.getElementById('searchClose').addEventListener('click', () => dialog.close());
    document.getElementById('searchOverlay').addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => {
      results.textContent = input.value.trim() ? '还没有发布文章，暂时没有搜索结果。' : '还没有文章，发布后就能在这里搜索。';
    });
    dialog.addEventListener('close', () => {
      input.value = '';
      results.textContent = '还没有文章，发布后就能在这里搜索。';
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); showSearch(); }
    });
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
    }), { threshold: .1 });
    document.querySelectorAll('.reveal, .reveal-stagger').forEach(el => {
      if (reduceMotion.matches) el.classList.add('revealed'); else observer.observe(el);
    });
    const back = document.getElementById('backToTop');
    new IntersectionObserver(([entry]) => back.classList.toggle('is-visible', !entry.isIntersecting)).observe(document.getElementById('pageStart'));
    back.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' }));
    const replay = document.getElementById('swarmReplayBtn');
    const syncMotion = () => {
      replay.disabled = reduceMotion.matches;
      replay.title = reduceMotion.matches ? '已按系统设置减少动态效果' : '重播页面构建动效';
      if (reduceMotion.matches) SwarmIntroManager.cleanup(true);
    };
    reduceMotion.addEventListener('change', syncMotion);
    syncMotion();
    document.querySelectorAll('.bento-tech .tech-pill').forEach(el => el.setAttribute('tabindex', '-1'));
  }
  document.addEventListener('DOMContentLoaded', () => {
    initControls();
    SwarmIntroManager.init();
  });
})();
