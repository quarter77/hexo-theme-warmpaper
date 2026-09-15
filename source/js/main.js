// Mobile nav toggle
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    var expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    nav.classList.toggle('open');
  });

  // Close menu when a nav link is clicked
  nav.addEventListener('click', function (e) {
    if (e.target.classList.contains('nav-link')) {
      toggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
    }
  });
})();

(function () {
  // TOC scroll tracking
  var sidebar = document.querySelector('.toc-sidebar');
  var wrapper = sidebar && sidebar.querySelector('.toc-wrapper');
  var postContent = document.querySelector('.post-content');
  if (!sidebar || !wrapper || !postContent) return;

  var indicator = wrapper.querySelector('.toc-indicator');
  var header = document.querySelector('.site-header');

  // 目录链接 → 标题元素的一一映射。必须由链接反推标题，而不是自己去查 h1~h4：
  // 目录只收录 min_depth~max_depth 之间的层级，若以标题列表驱动，范围外的标题
  // 会匹配不到链接，把高亮整个清空。
  var items = [];
  var links = wrapper.querySelectorAll('.toc a');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href');
    // 没有 id 的标题，Hexo 不会给它输出 href 属性
    if (!href || href.charAt(0) !== '#') continue;
    var raw = href.slice(1);
    // Hexo 的 toc helper 对 href 做了 encodeURI，而标题 id 保留原始 UTF-8，
    // 所以中文标题下两者并不相等，必须解码后再查一次。
    // 标题里出现裸 % 时 decodeURIComponent 会抛 URIError，不能让它掀翻整段脚本。
    var el = document.getElementById(raw);
    if (!el) {
      try { el = document.getElementById(decodeURIComponent(raw)); } catch (e) {}
    }
    // 校验元素确实在正文里，避免 id 撞上导航栏等处的元素
    if (el && postContent.contains(el)) items.push({ link: links[i], el: el });
  }
  if (!items.length) return;

  var current = -1;
  var enabled = true;
  var ticking = false;
  var primed = false;
  var locked = false;
  var lockIndex = -1;
  var lockTimer = null;

  // 判定线：视口顶部往下多少像素处算「已经读到这一节」。
  // 不变量：必须大于等于 html 的 scroll-padding-top（= 导航栏高度 + 1rem）。
  // 否则点击目录后标题恰好停在 scroll-padding-top 处，亚像素误差会被判成
  // 「还没到」，高亮当场跳回上一节。这里直接量导航栏实际高度，因此也覆盖了
  // 断点切换和导航栏换行变高的情况。
  function line() {
    return (header ? header.getBoundingClientRect().height : 60) + 24;
  }

  function compute() {
    var limit = line();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      // 标题在文档流中自上而下排列，遇到第一个还没越线的就可以停
      if (items[i].el.getBoundingClientRect().top <= limit) idx = i;
      else break;
    }
    // 兜底：末节太短，滚到页面底部也没能把它推过判定线
    var docHeight = document.documentElement.scrollHeight;
    if (idx < items.length - 1 &&
        docHeight > window.innerHeight + 2 &&
        window.innerHeight + window.pageYOffset >= docHeight - 2) {
      idx = items.length - 1;
    }
    return idx;
  }

  // 链接相对目录容器内容原点的偏移。该式对 wrapper.scrollTop 恒定
  //（scrollTop 增加多少，链接的 rect.top 就减少多少，正好抵消），
  // 所以「先滚目录还是先摆指示条」的先后顺序不影响结果。
  function offsetIn(rect) {
    return rect.top - wrapper.getBoundingClientRect().top -
           wrapper.clientTop + wrapper.scrollTop;
  }

  function apply(idx) {
    if (idx === current) return;
    current = idx;

    for (var i = 0; i < items.length; i++) {
      items[i].link.classList.remove('active');
      items[i].link.removeAttribute('aria-current');
    }

    if (idx < 0) {
      if (indicator) indicator.classList.remove('is-visible');
      return;
    }

    var link = items[idx].link;
    // 先写 class 再读几何：万一 active 样式影响了布局，读到的必须是生效之后的值
    link.classList.add('active');
    link.setAttribute('aria-current', 'location');

    var rect = link.getBoundingClientRect();
    var top = offsetIn(rect);
    var bottom = top + rect.height;

    // 目录很长时把当前项带回可视区。只在切章时做，否则用户手动滚目录会被一直拽回来。
    // 不能用 scrollIntoView：它会连带滚动包括 window 在内的所有可滚动祖先，
    // 在滚动回调里调用等于自激。
    if (top < wrapper.scrollTop) {
      wrapper.scrollTop = top - 12;
    } else if (bottom > wrapper.scrollTop + wrapper.clientHeight) {
      wrapper.scrollTop = bottom - wrapper.clientHeight + 12;
    }

    if (indicator) {
      // 重新取一次：上面可能刚改过 scrollTop
      top = offsetIn(link.getBoundingClientRect());
      indicator.style.transform = 'translateY(' + top + 'px)';
      indicator.style.height = rect.height + 'px';
      if (!primed) {
        // 首次定位不要动画，否则指示条会从目录顶部滑下来
        primed = true;
        indicator.classList.add('no-anim');
        indicator.classList.add('is-visible');
        requestAnimationFrame(function () {
          indicator.classList.remove('no-anim');
        });
      } else {
        indicator.classList.add('is-visible');
      }
    }
  }

  function unlock() {
    locked = false;
    lockIndex = -1;
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  function run() {
    ticking = false;
    if (!enabled) return;
    var idx = compute();
    if (locked) {
      // 主力解锁条件：已经滚到点击的那一节了
      if (idx === lockIndex) unlock();
      return;
    }
    apply(idx);
  }

  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(run);
  }

  window.addEventListener('scroll', schedule, { passive: true });

  // 点击目录项、或正文标题旁的锚点链接后立刻高亮目标并暂时接管，
  // 避免平滑滚动途中高亮被沿途章节逐个抢走。
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    if (!wrapper.contains(a) && !a.classList.contains('headerlink')) return;

    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    var raw = href.slice(1);
    var target = document.getElementById(raw);
    if (!target) {
      try { target = document.getElementById(decodeURIComponent(raw)); } catch (err) {}
    }
    if (!target) return;

    for (var i = 0; i < items.length; i++) {
      if (items[i].el !== target) continue;
      unlock();
      apply(i);
      locked = true;
      lockIndex = i;
      // 兜底而已：Chrome 的平滑滚动时长随距离增长，Firefox 用弹簧物理，
      // 固定短超时在长文里会提前解锁，所以放宽，主要依靠上面和下面几路提前解锁。
      lockTimer = setTimeout(unlock, 1500);
      break;
    }
  });

  // 用户自己动手滚动，或平滑滚动自然结束，都立即交还控制权
  ['wheel', 'touchstart', 'keydown'].forEach(function (type) {
    window.addEventListener(type, function () {
      if (locked) unlock();
    }, { passive: true });
  });
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', function () {
      if (locked) unlock();
    });
  }

  function refresh() {
    // 目录被媒体查询隐藏时 offsetParent 为 null，此时无需每帧空跑
    enabled = sidebar.offsetParent !== null;
    if (enabled && current >= 0 && indicator) {
      var top = offsetIn(items[current].link.getBoundingClientRect());
      indicator.style.transform = 'translateY(' + top + 'px)';
    }
    schedule();
  }

  // 判定线每帧实时读取，本身免疫回流；但没有滚动就不会重算。MathJax 是延迟加载的，
  // Web 字体也可能在本脚本执行之后才到位，带锚点直接进入或从 bfcache 恢复时，
  // 初始状态会是错的且在用户滚动前不会自愈。
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(refresh);
    ro.observe(postContent);
    ro.observe(wrapper);
  } else {
    window.addEventListener('resize', refresh);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule);
  }
  window.addEventListener('load', schedule);

  enabled = sidebar.offsetParent !== null;
  run();
})();

// Search panel
(function () {
  var toggle = document.querySelector('.search-toggle');
  var panel = document.querySelector('.search-panel');
  var input = document.querySelector('#search-input');
  var status = document.querySelector('#search-status');
  var results = document.querySelector('#search-results');
  if (!toggle || !panel || !input || !status || !results) return;

  var recordsPromise = null;
  var records = [];
  var previousFocus = null;
  var searchCore = window.WarmpaperSearchCore;

  function stripMarkup(value) {
    var holder = document.createElement('div');
    holder.innerHTML = String(value || '');
    return holder.textContent || '';
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function makeExcerpt(text, terms) {
    var clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= 180) return clean;
    var position = -1;
    for (var i = 0; i < terms.length; i++) {
      var found = normalize(clean).indexOf(terms[i]);
      if (found !== -1 && (position === -1 || found < position)) position = found;
    }
    var start = position > 60 ? position - 60 : 0;
    return (start ? '... ' : '') + clean.slice(start, start + 180) + (start + 180 < clean.length ? ' ...' : '');
  }

  function appendHighlighted(parent, text, terms) {
    var segments = searchCore.highlightText(text, terms);
    segments.forEach(function (segment) {
      if (segment.highlight) {
        var mark = document.createElement('mark');
        mark.textContent = segment.text;
        parent.appendChild(mark);
      } else {
        parent.appendChild(document.createTextNode(segment.text));
      }
    });
  }

  function setStatus(message, state) {
    status.textContent = message;
    status.className = 'search-status' + (state ? ' is-' + state : '');
  }

  function loadIndex() {
    if (recordsPromise) return recordsPromise;
    setStatus('正在加载搜索索引...', 'loading');
    recordsPromise = fetch(panel.getAttribute('data-search-path'), { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Search index request failed');
        return response.json();
      })
      .then(function (data) {
        records = Array.isArray(data) ? data : [];
        return records;
      });
    recordsPromise.catch(function () {
      recordsPromise = null;
      setStatus('搜索索引加载失败，请稍后重试。', 'error');
    });
    return recordsPromise;
  }

  function search(query) {
    var terms = normalize(query).split(' ').filter(Boolean);
    results.textContent = '';
    if (!terms.length) { setStatus('输入关键词开始搜索。'); return; }
    if (!searchCore) { setStatus('搜索功能加载失败，请刷新页面重试。', 'error'); return; }
    var prepared = records.map(function (record) {
      return Object.assign({}, record, { content: stripMarkup(record.content) });
    });
    var matches = searchCore.searchRecords(prepared, query).slice(0, 20).map(function (record) {
      return { record: record, title: record.title || '未命名文章', content: normalize(record.content) };
    });
    if (!matches.length) { setStatus('没有找到匹配的文章。', 'empty'); return; }
    setStatus('找到 ' + matches.length + ' 篇文章。');
    matches.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'search-result';
      var link = document.createElement('a');
      link.className = 'search-result-link';
      link.href = item.record.url || item.record.path || '#';
      var title = document.createElement('span');
      title.className = 'search-result-title';
      appendHighlighted(title, item.title, terms);
      var meta = document.createElement('time');
      meta.className = 'search-result-date';
      if (item.record.date) {
        var date = new Date(item.record.date);
        meta.textContent = isNaN(date.getTime()) ? String(item.record.date) : date.toLocaleDateString('zh-CN');
      }
      var summary = document.createElement('span');
      summary.className = 'search-result-excerpt';
      appendHighlighted(summary, makeExcerpt(item.content, terms), terms);
      link.appendChild(title);
      if (meta.textContent) link.appendChild(meta);
      link.appendChild(summary);
      li.appendChild(link);
      results.appendChild(li);
    });
  }

  function openPanel() {
    previousFocus = document.activeElement;
    panel.hidden = false;
    panel.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    loadIndex().then(function () { search(input.value); }).catch(function () {});
    window.setTimeout(function () { input.focus(); }, 0);
  }

  function closePanel() {
    panel.hidden = true;
    panel.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  toggle.addEventListener('click', function () { if (panel.hidden) openPanel(); else closePanel(); });
  panel.querySelector('.search-close').addEventListener('click', closePanel);
  input.addEventListener('input', function () { search(input.value); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !panel.hidden) closePanel(); });
  panel.addEventListener('click', function (event) { if (event.target === panel) closePanel(); });
})();

// Theme toggle
(function () {
  var STORAGE_KEY = 'warmpaper-theme';
  var btn = document.querySelector('.theme-toggle');
  if (!btn) return;

  var mql = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return mql.matches ? 'dark' : 'light';
  }

  function syncIcon() {
    btn.setAttribute('data-theme-state', currentTheme());
  }

  btn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    btn.setAttribute('data-theme-state', next);
  });

  mql.addEventListener('change', function () {
    var hasManual = false;
    try { hasManual = !!localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!hasManual) syncIcon();
  });

  syncIcon();
})();
