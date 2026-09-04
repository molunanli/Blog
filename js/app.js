/* ==========================================================================
   全站交互逻辑
   --------------------------------------------------------------------------
   主题 / 抽屉导航 / 全局搜索 / 目录滚动高亮 / 代码块 / 阅读进度 / 评论 / 表单
   Hexo 版：文章列表与正文由服务端渲染，脚本只负责交互。
   所有用户输入在写入 DOM 前统一经过 esc() 转义，避免 XSS。
   ========================================================================== */
(function () {
    'use strict';

    var THEME_KEY = 'manga-blog-theme';
    var COMMENT_KEY = 'manga-blog-comments';

    /* ================= 工具 ================= */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function relTime(ts) {
        var d = (Date.now() - ts) / 1000;
        if (d < 60) return '刚刚';
        if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
        if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
        if (d < 2592000) return Math.floor(d / 86400) + ' 天前';
        var t = new Date(ts);
        return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    }
    function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function debounce(fn, wait) {
        var t; return function () {
            var a = arguments, c = this;
            clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, wait);
        };
    }
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ================= Toast ================= */
    var toastHost = null;
    function toast(msg, kind) {
        if (!toastHost) {
            toastHost = document.createElement('div');
            toastHost.className = 'toasts';
            toastHost.setAttribute('role', 'status');
            toastHost.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastHost);
        }
        var el = document.createElement('div');
        el.className = 'toast' + (kind ? ' toast--' + kind : '');
        el.textContent = msg;
        toastHost.appendChild(el);
        setTimeout(function () {
            el.classList.add('is-out');
            setTimeout(function () { el.remove(); }, 320);
        }, 2400);
    }

    /* ================= 主题 ================= */
    var themeBtn = $('#themeToggle');

    function paintTheme(t) {
        var dark = t === 'dark';
        if (themeBtn) {
            themeBtn.textContent = dark ? '☀️' : '🌙';
            themeBtn.setAttribute('data-tip', dark ? '亮色模式' : '暗色模式');
            themeBtn.setAttribute('title', dark ? '切换至亮色模式' : '切换至暗色模式');
            themeBtn.setAttribute('aria-label', dark ? '切换至亮色模式' : '切换至暗色模式');
            themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        }
        $$('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', dark ? '#211f1c' : '#f7f1e3'); });
    }

    function setTheme(t, persist) {
        document.documentElement.setAttribute('data-theme', t);
        paintTheme(t);
        if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
    }

    setTheme(document.documentElement.getAttribute('data-theme') || 'light', false);

    if (themeBtn) {
        themeBtn.addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            setTheme(next, true);
            toast(next === 'dark' ? '已切换到暗色模式 🌙' : '已切换到亮色模式 ☀️');
            syncGiscusTheme();
        });
    }

    try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
            if (!localStorage.getItem(THEME_KEY)) setTheme(e.matches ? 'dark' : 'light', false);
        });
    } catch (e) {}

    /* —— Giscus 评论：主题跟随站点明暗 —— */
    // giscus client.js 为 async 加载，页面就绪时可能尚未执行完，
    // 因此轮询等 window.giscus 出现后，用 setConfig 切换 iframe 主题。
    var hasGiscus = !!document.querySelector('script[src*="giscus.app/client.js"]');
    // 新版 giscus 不再暴露 window.giscus，主题切换需向 iframe 发送 postMessage
    function syncGiscusTheme() {
        var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        var frame = document.querySelector('iframe.giscus-frame');
        if (!frame || !frame.contentWindow) return false;
        frame.contentWindow.postMessage({ giscus: { setConfig: { theme: theme } } }, 'https://giscus.app');
        return true;
    }
    if (hasGiscus) {
        // 等 giscus iframe 出现后再同步一次初始主题
        var gTries = 0;
        var gTimer = setInterval(function () {
            if (syncGiscusTheme() || ++gTries > 80) clearInterval(gTimer); // ≤24s 兜底
        }, 300);
    }

    /* ================= 抽屉导航 ================= */
    var burger = $('#burgerBtn');
    var drawer = $('#drawer');
    var backdrop = $('#drawerBackdrop');
    var lastFocus = null;

    function openDrawer() {
        if (!drawer) return;
        lastFocus = document.activeElement;
        drawer.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        if (burger) burger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        var first = drawer.querySelector('a, button');
        if (first) first.focus();
    }
    function closeDrawer() {
        if (!drawer) return;
        drawer.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        if (burger) burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        if (lastFocus) lastFocus.focus();
    }
    if (burger) burger.addEventListener('click', function () {
        drawer && drawer.classList.contains('open') ? closeDrawer() : openDrawer();
    });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    var drawerClose = $('#drawerClose');
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    if (drawer) drawer.addEventListener('click', function (e) {
        if (e.target.closest('a')) closeDrawer();
    });

    /* ================= 当前页高亮 ================= */
    (function markCurrent() {
        // 页面真实路径可能带 root 前缀（如 /Blog/），data-nav 则是相对 root 的路径
        // （'/'、'/archives'）。必须先把 root 前缀剥掉再匹配：
        // 否则首页 data-nav='/' 会被当成所有页面的前缀，导致永远高亮。
        var root = document.body ? document.body.getAttribute('data-root') || '' : '';
        var raw = location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '') || '/';
        var here = raw;
        var cleanRoot = root.replace(/\/+$/, '');
        if (cleanRoot && cleanRoot !== '/' && raw.indexOf(cleanRoot) === 0) {
            here = raw.slice(cleanRoot.length) || '/';
        }
        if (here.charAt(0) !== '/') here = '/' + here;
        $$('[data-nav]').forEach(function (a) {
            var target = (a.getAttribute('data-nav') || '').replace(/\/+$/, '') || '/';
            if (!target) return;
            // 首页（'/'）只做整段相等匹配；其余菜单项再做"子路径"匹配
            var hit = (here === target) || (target !== '/' && here.indexOf(target + '/') === 0);
            if (hit) a.setAttribute('aria-current', 'page');
        });
    })();
    /* ================= 回到顶部 ================= */
    var topBtn = $('#topBtn');
    if (topBtn) {
        var ticking = false;
        function syncTop() {
            var show = window.scrollY > 320;
            topBtn.classList.toggle('is-on', show);
            topBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () { syncTop(); ticking = false; });
        }, { passive: true });
        topBtn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        });
        syncTop();
    }

    /* ================= 入场揭示 ================= */
    var revealIO = null;
    if ('IntersectionObserver' in window && !reduceMotion) {
        revealIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    e.target.classList.add('in');
                    revealIO.unobserve(e.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    }
    function observeReveals(root) {
        $$('.reveal', root || document).forEach(function (el) {
            if (revealIO) revealIO.observe(el); else el.classList.add('in');
        });
    }

    /* ================= 全局搜索浮层 ================= */
    var searchBtn = $('#searchBtn');
    var overlay = $('#searchOverlay');
    var sInput, sResults, sCursor = -1, sHits = [];

    // 索引来自 Hexo 生成的 search.json，首次打开搜索时懒加载
    var searchIndex = null, indexPending = null;
    function loadIndex() {
        if (searchIndex) return Promise.resolve(searchIndex);
        if (indexPending) return indexPending;
        var url = window.SEARCH_JSON_URL || '/search.json';
        indexPending = fetch(url).then(function (r) { return r.json(); }).then(function (d) {
            searchIndex = Array.isArray(d) ? d : [];
            indexPending = null;
            return searchIndex;
        }).catch(function () {
            searchIndex = [];
            indexPending = null;
            return searchIndex;
        });
        return indexPending;
    }

    function paintResults(q, list) {
        if (!sResults) return;
        var kw = q.trim().toLowerCase();
        sHits = [];
        if (kw) {
            sHits = list.filter(function (a) {
                var hay = (a.title + ' ' + a.excerpt + ' ' + a.category + ' ' + (a.tags || []).join(' ')).toLowerCase();
                return hay.indexOf(kw) !== -1;
            });
        } else {
            sHits = list.slice(0, 6);
        }
        sCursor = -1;

        if (!sHits.length) {
            sResults.innerHTML = '<div class="empty" style="padding:34px 12px">' +
                '<span class="empty-emoji" aria-hidden="true">🔍</span>' +
                '<p class="empty-title">没有找到「' + esc(q) + '」</p>' +
                '<p class="empty-text">换个关键词试试，或者去归档页按年份浏览。</p></div>';
            return;
        }
        sResults.innerHTML = sHits.map(function (a, i) {
            return '<a class="search-item" href="' + a.url + '" data-i="' + i + '">' +
                '<span class="t">' + esc(a.title) + '</span>' +
                '<span class="m">' + esc(a.category || '') + ' · ' + esc(a.dateLabel || '') + ' · 约 ' + (a.readTime || 0) + ' 分钟</span>' +
                '</a>';
        }).join('');
    }

    function renderResults(q) {
        loadIndex().then(function (list) { paintResults(q, list); });
    }

    function moveCursor(step) {
        if (!sHits.length) return;
        sCursor = (sCursor + step + sHits.length) % sHits.length;
        $$('.search-item', sResults).forEach(function (el, i) {
            el.classList.toggle('is-cursor', i === sCursor);
        });
        var cur = sResults.children[sCursor];
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    function openSearch() {
        if (!overlay) return;
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        renderResults(sInput ? sInput.value : '');
        setTimeout(function () { if (sInput) sInput.focus(); }, 60);
    }
    function closeSearch() {
        if (!overlay) return;
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (searchBtn) searchBtn.focus();
    }

    if (overlay) {
        sInput = $('#searchInput', overlay);
        sResults = $('#searchResults', overlay);
        if (searchBtn) searchBtn.addEventListener('click', openSearch);
        var fabSearch = $('#fabSearch');
        if (fabSearch) fabSearch.addEventListener('click', openSearch);
        var nfSearch = $('#nfSearch');
        if (nfSearch) nfSearch.addEventListener('click', openSearch);
        $('#searchClose', overlay).addEventListener('click', closeSearch);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeSearch();
            var item = e.target.closest('.search-item');
            if (item) closeSearch();
        });
        if (sInput) {
            sInput.addEventListener('input', debounce(function () { renderResults(sInput.value); }, 120));
            sInput.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
                else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (sCursor >= 0 && sHits[sCursor]) location.href = sHits[sCursor].url;
                    else if (sHits.length) location.href = sHits[0].url;
                }
            });
        }
    }

    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            overlay.classList.contains('open') ? closeSearch() : openSearch();
        } else if (e.key === 'Escape') {
            if (overlay && overlay.classList.contains('open')) closeSearch();
            else if (drawer && drawer.classList.contains('open')) closeDrawer();
        }
    });
    /* ================= 首页：分类筛选 + 关键字过滤 ================= */
    (function homeFilter() {
        var homeRoot = $('#homeRoot');
        if (!homeRoot) return;
        var cards = $$('.post-card', homeRoot);
        if (!cards.length) return;

        var filterBox = $('#catFilters');
        var current = '全部';
        var catMap = {};
        cards.forEach(function (c) {
            var cat = c.getAttribute('data-cat') || '未分类';
            catMap[cat] = (catMap[cat] || 0) + 1;
        });

        if (filterBox) {
            var cats = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; });
            filterBox.innerHTML = ['全部'].concat(cats).map(function (name) {
                var n = name === '全部' ? cards.length : catMap[name];
                return '<button type="button" class="filter-btn" data-cat="' + esc(name) + '"' +
                    ' aria-pressed="' + (name === current ? 'true' : 'false') + '">' +
                    esc(name) + ' <span style="opacity:.7">(' + n + ')</span></button>';
            }).join('');
            filterBox.addEventListener('click', function (e) {
                var b = e.target.closest('.filter-btn');
                if (!b) return;
                current = b.getAttribute('data-cat');
                $$('.filter-btn', filterBox).forEach(function (x) {
                    x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
                });
                apply();
            });
        }

        var kwInput = $('#listSearch');
        if (kwInput) kwInput.addEventListener('input', debounce(apply, 140));

        function apply() {
            var kw = kwInput ? kwInput.value.trim().toLowerCase() : '';
            var shown = 0;
            cards.forEach(function (c) {
                var cat = c.getAttribute('data-cat') || '未分类';
                var okCat = current === '全部' || cat === current;
                var tags = (c.getAttribute('data-tags') || '').toLowerCase();
                var hay = c.textContent.toLowerCase() + ' ' + tags;
                var okKw = !kw || hay.indexOf(kw) !== -1;
                var ok = okCat && okKw;
                c.style.display = ok ? '' : 'none';
                if (ok) shown++;
            });
            var count = $('#resultCount');
            if (count) {
                count.textContent = (current === '全部' && !kw)
                    ? '共 ' + cards.length + ' 篇'
                    : '筛选出 ' + shown + ' 篇';
            }
        }
        apply();
    })();
    /* ================= 文章详情页 ================= */
    // 提到外层作用域，供评论表单在提交后复用渲染逻辑
    var renderComments = null;
    var articleRoot = $('#articleRoot');
    if (articleRoot) {
        // 正文与目录由 Hexo 服务端渲染，这里只读取元信息供分享 / 点赞 / 评论使用
        var articleBody = $('#articleBody');
        var post = {
            id: articleRoot.dataset.postId || location.pathname,
            title: articleRoot.dataset.postTitle || document.title,
            likes: parseInt(articleRoot.dataset.postLikes || '0', 10)
        };
        // 目录滚动高亮
        var tocLinks = $$('.toc-link');
        var linkById = {};
        tocLinks.forEach(function (l) { linkById[l.getAttribute('href').slice(1)] = l; });
        // headings 是模板注入的纯数据（{level,id,text}），转成对应 DOM 元素供观察
        var tocEls = headings.map(function (h) { return document.getElementById(h.id); })
            .filter(function (el) { return !!el; });

        function setActiveToc(activeId) {
            tocLinks.forEach(function (l) { l.classList.remove('is-active', 'is-parent'); });
            var cur = linkById[activeId];
            if (!cur) return;
            cur.classList.add('is-active');
            if (cur.classList.contains('toc-link--h3')) {
                var node = document.getElementById(activeId);
                while (node && node !== articleBody) {
                    node = node.previousElementSibling;
                    if (node && node.tagName === 'H2' && linkById[node.id]) {
                        linkById[node.id].classList.add('is-parent');
                        break;
                    }
                }
            }
        }

        if ('IntersectionObserver' in window && tocEls.length) {
            var seen = {};
            var spy = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) { seen[e.target.id] = e.isIntersecting; });
                var best = null, bestTop = Infinity;
                tocEls.forEach(function (h) {
                    if (!seen[h.id]) return;
                    var t = h.getBoundingClientRect().top;
                    if (t >= 0 && t < bestTop) { bestTop = t; best = h.id; }
                });
                if (!best) {
                    // 全部在视口上方时取最后一个已滚过的标题
                    for (var i = tocEls.length - 1; i >= 0; i--) {
                        if (tocEls[i].getBoundingClientRect().top < 120) { best = tocEls[i].id; break; }
                    }
                }
                if (best) setActiveToc(best);
            }, { rootMargin: '-90px 0px -70% 0px', threshold: 0 });
            tocEls.forEach(function (h) { spy.observe(h); });
        }

        // 移动端目录折叠
        var tocBtn = $('#tocToggle');
        var tocPanel = $('#tocPanel');
        if (tocBtn && tocPanel) {
            tocBtn.addEventListener('click', function () {
                var open = tocPanel.classList.toggle('open');
                tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            tocPanel.addEventListener('click', function (e) {
                if (e.target.closest('.toc-link') && window.innerWidth < 900) {
                    tocPanel.classList.remove('open');
                    tocBtn.setAttribute('aria-expanded', 'false');
                }
            });
        }

        // 代码块：复制 / 折叠
        articleBody.addEventListener('click', function (e) {
            var copy = e.target.closest('.js-copy');
            var fold = e.target.closest('.js-fold');
            if (copy) {
                var block = copy.closest('.code-block');
                var code = $('code', block);
                var text;
                if (code) {
                    text = code.innerText;
                } else {
                    // 标准 Markdown 代码块（figure.highlight 结构）：取代码列，跳过行号列
                    var pre = $('.code pre', block) || $('.code-wrap pre', block);
                    text = pre ? pre.innerText : '';
                }
                if (!text) return;
                var done = function () {
                    var old = copy.textContent;
                    copy.textContent = '✅ 已复制';
                    toast('代码已复制到剪贴板', 'ok');
                    setTimeout(function () { copy.textContent = old; }, 1800);
                };
                function fallback() {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
                    document.body.appendChild(ta);
                    ta.select();
                    var ok = false;
                    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
                    document.body.removeChild(ta);
                    if (ok) done(); else toast('复制失败，请手动选择', 'err');
                }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    // writeText 在部分环境（headless / 未激活）会一直挂起，超时兜底走 execCommand
                    var timer = setTimeout(fallback, 800);
                    navigator.clipboard.writeText(text).then(function () {
                        clearTimeout(timer);
                        done();
                    }, function () {
                        clearTimeout(timer);
                        fallback();
                    });
                } else fallback();
            }
            if (fold) {
                var block = fold.closest('.code-block');
                var collapsed = block.classList.toggle('is-collapsed');
                fold.textContent = collapsed ? '展开 ▼' : '收起 ▲';
                fold.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            }
        });

        // 代码块：按内容高度自动折叠
        // 超过阈值默认收起（按钮变实心朱红 + 底部渐隐提示），
        // 没超过阈值的标记为短代码块，折叠按钮由 CSS 隐藏，避免出现"点了没变化"的按钮
        (function initCodeFold() {
            var FOLD_MAX = 190; // 与 CSS 中 .is-collapsed .code-wrap 的 max-height 保持一致
            var seq = 0;
            $$('.code-block', articleBody).forEach(function (block) {
                var wrap = $('.code-wrap', block);
                var btn = $('.js-fold', block);
                if (!wrap || !btn) return;
                var need = wrap.scrollHeight > FOLD_MAX + 24;
                block.classList.toggle('is-short', !need);
                block.classList.toggle('is-collapsed', need);
                btn.textContent = need ? '展开 ▼' : '收起 ▲';
                btn.setAttribute('aria-expanded', need ? 'false' : 'true');
                if (!wrap.id) wrap.id = 'codeWrap' + (++seq);
                btn.setAttribute('aria-controls', wrap.id);
            });
        })();

        // 阅读进度
        var bar = $('#progressBar');
        if (bar) {
            var pt = false;
            function syncProgress() {
                var r = articleBody.getBoundingClientRect();
                var total = r.height - window.innerHeight;
                var done = total <= 0 ? 100 : Math.min(100, Math.max(0, (-r.top / total) * 100));
                bar.style.width = done.toFixed(2) + '%';
                bar.closest('.progress-track').setAttribute('aria-valuenow', Math.round(done));
            }
            window.addEventListener('scroll', function () {
                if (pt) return; pt = true;
                requestAnimationFrame(function () { syncProgress(); pt = false; });
            }, { passive: true });
            syncProgress();
        }

        // 分享
        var shareRow = $('#shareRow');
        if (shareRow) {
            var url = location.href;
            var text = post.title + ' — 少年漫画ブログ';
            var targets = [
                { k: '𝕏', label: '分享到 X', href: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url) },
                { k: '微博', label: '分享到微博', href: 'https://service.weibo.com/share/share.php?title=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url) }
            ];
            // 点赞统一由评论区 Giscus 的 +1 reaction 承担（GitHub 持久化），
            // 不再注入 localStorage 演示点赞按钮
            shareRow.innerHTML = targets.map(function (t) {
                return '<a class="chip" href="' + t.href + '" target="_blank" rel="noopener noreferrer">' + t.k + ' ' + t.label + '</a>';
            }).join('') + '<button type="button" class="chip" id="copyLink">🔗 复制链接</button>';

            $('#copyLink').addEventListener('click', function () {
                var u = location.href;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(u).then(function () { toast('链接已复制', 'ok'); });
                } else { toast('请手动复制地址栏链接', 'err'); }
            });
        }

        /* ---------- 评论（localStorage 持久化） ---------- */
        var SEED = [
            { name: '新人漫画家チコ', text: '正在为第一次投稿做准备，这篇正好解了我的惑。集中线那段我练了整整一周……', mins: 96 },
            { name: 'ベテラン・森下', text: '补充一点：贴网前一定要确认原稿完全干透，不然网点胶会和墨迹反应，放几天就发黄。', mins: 420 },
            { name: '週刊读者A', text: '看完立刻把笔刷参数改了一遍，手ブレ補正 从 15 调到 10，线条确实活过来了。', mins: 1500 }
        ];

        function loadComments() {
            var all = {};
            try { all = JSON.parse(localStorage.getItem(COMMENT_KEY) || '{}'); } catch (e) { all = {}; }
            if (!all[post.id]) {
                all[post.id] = SEED.map(function (s, i) {
                    return { id: 'seed-' + i, name: s.name, text: s.text, ts: Date.now() - s.mins * 60000, likes: [3, 12, 7][i] || 0, liked: false, seed: true };
                });
            }
            return all;
        }
        function saveComments(all) {
            try { localStorage.setItem(COMMENT_KEY, JSON.stringify(all)); } catch (e) {}
        }

        var commentList = $('#commentList');
        var commentCount = $('#commentCount');

        // 评论区已由 Giscus 接管（post.ejs 不再输出 #commentList），
        // 元素不存在时整套本地演示渲染直接跳过
        if (commentList) {
        renderComments = function () {
            var all = loadComments();
            var list = all[post.id] || [];
            if (commentCount) commentCount.textContent = list.length;
            if (!list.length) {
                commentList.innerHTML = '<div class="empty" style="padding:28px 12px">' +
                    '<span class="empty-emoji" aria-hidden="true">💬</span>' +
                    '<p class="empty-title">还没有人留言</p><p class="empty-text">来抢第一个沙发吧。</p></div>';
                return;
            }
            commentList.innerHTML = list.map(function (c) {
                return '<div class="comment" data-cid="' + esc(c.id) + '">' +
                    '<div class="comment-avatar" aria-hidden="true">' + (c.seed ? '😺' : '🙋') + '</div>' +
                    '<div class="comment-main">' +
                    '<div class="comment-head">' +
                    '<span class="comment-name">' + esc(c.name) + '</span>' +
                    (c.seed ? '<span class="comment-badge">读者</span>' : '') +
                    '<span class="comment-time">' + relTime(c.ts) + '</span>' +
                    '</div>' +
                    '<p class="comment-text">' + esc(c.text) + '</p>' +
                    '<div class="comment-actions">' +
                    '<button type="button" class="comment-like" aria-pressed="' + (c.liked ? 'true' : 'false') + '">' +
                    '👍 <span>' + (c.likes || 0) + '</span></button>' +
                    '</div></div></div>';
            }).join('');
        };

        commentList.addEventListener('click', function (e) {
            var btn = e.target.closest('.comment-like');
            if (!btn) return;
            var wrap = btn.closest('.comment');
            var cid = wrap.getAttribute('data-cid');
            var all = loadComments();
            var c = (all[post.id] || []).filter(function (x) { return x.id === cid; })[0];
            if (!c) return;
            c.liked = !c.liked;
            c.likes = (c.likes || 0) + (c.liked ? 1 : -1);
            saveComments(all);
            renderComments();
        });

            renderComments();
        }
    }

    /* ================= 表单：邮箱订阅 ================= */
    var subForm = $('#subscribeForm');
    if (subForm) {
        var subInput = $('#subscribeEmail');
        var subErr = $('#subscribeError');
        function fail(msg) {
            subErr.textContent = msg;
            subErr.classList.add('show');
            subInput.setAttribute('aria-invalid', 'true');
            subInput.focus();
        }
        subForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var v = subInput.value.trim();
            subErr.classList.remove('show');
            subInput.setAttribute('aria-invalid', 'false');
            if (!v) return fail('请填写邮箱地址（输入内容已保留）');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return fail('邮箱格式不太对，请检查一下（输入内容已保留）');
            // 模拟异步提交：按钮进入加载态
            var btn = $('#subscribeBtn');
            var old = btn.textContent;
            btn.disabled = true; btn.textContent = '提交中…';
            setTimeout(function () {
                btn.disabled = false; btn.textContent = old;
                subInput.value = '';
                toast('订阅成功，每周三准时更新 📬', 'ok');
            }, 900);
        });
    }

    /* ================= 表单：评论 ================= */
    var cForm = $('#commentForm');
    if (cForm) {
        var nameIn = $('#commentName');
        var textIn = $('#commentText');
        var nameErr = $('#commentNameError');
        var textErr = $('#commentTextError');

        cForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var ok = true;
            nameErr.classList.remove('show'); textErr.classList.remove('show');
            nameIn.setAttribute('aria-invalid', 'false'); textIn.setAttribute('aria-invalid', 'false');

            if (!nameIn.value.trim()) {
                nameErr.textContent = '请填写昵称（已输入的内容已保留）';
                nameErr.classList.add('show');
                nameIn.setAttribute('aria-invalid', 'true');
                ok = false;
            }
            if (textIn.value.trim().length < 4) {
                textErr.textContent = '留言至少 4 个字（已输入的内容已保留）';
                textErr.classList.add('show');
                textIn.setAttribute('aria-invalid', 'true');
                ok = false;
            }
            if (!ok) { (nameIn.getAttribute('aria-invalid') === 'true' ? nameIn : textIn).focus(); return; }

            var pid = articleRoot ? (articleRoot.dataset.postId || location.pathname) : location.pathname;
            var store = {};
            try { store = JSON.parse(localStorage.getItem(COMMENT_KEY) || '{}'); } catch (err) { store = {}; }
            (store[pid] = store[pid] || []).push({
                id: 'c-' + Date.now(),
                name: nameIn.value.trim(),
                text: textIn.value.trim(),
                ts: Date.now(),
                likes: 0,
                liked: false
            });
            try { localStorage.setItem(COMMENT_KEY, JSON.stringify(store)); } catch (err) {}

            textIn.value = ''; // 昵称保留，方便连续留言
            toast('留言已发布（仅保存在本地浏览器）', 'ok');
            if (typeof renderComments === 'function') renderComments();
        });
    }

    /* ================= 关于页：技能条动画 ================= */
    var skillRoot = $('#skillRoot');
    if (skillRoot) {
        var meters = $$('.meter-fill', skillRoot);
        function fill() {
            meters.forEach(function (m) { m.style.width = m.getAttribute('data-v') + '%'; });
        }
        if ('IntersectionObserver' in window && !reduceMotion) {
            var io = new IntersectionObserver(function (es) {
                es.forEach(function (e) {
                    if (e.isIntersecting) { fill(); io.disconnect(); }
                });
            }, { threshold: 0.3 });
            io.observe(skillRoot);
        } else fill();
    }

    /* ================= 联系表单 ================= */
    var contactForm = $('#contactForm');
    if (contactForm) {
        var cName = $('#contactName'), cMail = $('#contactEmail'), cMsg = $('#contactMsg');
        var eName = $('#contactNameError'), eMail = $('#contactEmailError'), eMsg = $('#contactMsgError');
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            [eName, eMail, eMsg].forEach(function (n) { n.classList.remove('show'); });
            [cName, cMail, cMsg].forEach(function (n) { n.setAttribute('aria-invalid', 'false'); });
            var ok = true;
            if (!cName.value.trim()) { eName.textContent = '请填写称呼'; eName.classList.add('show'); cName.setAttribute('aria-invalid', 'true'); ok = false; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cMail.value.trim())) { eMail.textContent = '请填写有效的邮箱'; eMail.classList.add('show'); cMail.setAttribute('aria-invalid', 'true'); ok = false; }
            if (cMsg.value.trim().length < 8) { eMsg.textContent = '内容至少 8 个字'; eMsg.classList.add('show'); cMsg.setAttribute('aria-invalid', 'true'); ok = false; }
            if (!ok) return;
            var btn = $('#contactBtn'), old = btn.textContent;
            btn.disabled = true; btn.textContent = '发送中…';
            setTimeout(function () {
                btn.disabled = false; btn.textContent = old;
                cMsg.value = '';
                toast('已记录（演示环境不会真的发送邮件）', 'ok');
            }, 900);
        });
    }

    /* ================= 初始化：非详情页也走揭示动画 ================= */
    observeReveals(document);
})();
