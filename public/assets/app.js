(function () {
  const statePrefix = "kprss-reader:v4:";
  const els = {};
  let manifest = null;
  let currentDate = null;
  let currentData = null;
  let dayState = null;
  let renderedArticles = new Map();

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindElements();
    bindGlobalEvents();

    try {
      manifest = await fetchJson("data/manifest.json");
      const requested = new URLSearchParams(location.search).get("date");
      const initialDate = requested || manifest.latestDate;
      await loadDate(initialDate, { replace: !requested });
    } catch (error) {
      renderError(error);
    }
  }

  function bindElements() {
    els.pageTitle = document.getElementById("pageTitle");
    els.prevDay = document.getElementById("prevDay");
    els.nextDay = document.getElementById("nextDay");
    els.todayDay = document.getElementById("todayDay");
    els.datePicker = document.getElementById("datePicker");
    els.startReading = document.getElementById("startReading");
    els.toggleAllExpanded = document.getElementById("toggleAllExpanded");
    els.copyStarred = document.getElementById("copyStarred");
    els.articleCount = document.getElementById("articleCount");
    els.copyStatus = document.getElementById("copyStatus");
    els.articles = document.getElementById("articles");
    els.template = document.getElementById("articleTemplate");
  }

  function bindGlobalEvents() {
    els.prevDay.addEventListener("click", () => moveDate(1));
    els.nextDay.addEventListener("click", () => moveDate(-1));
    els.todayDay.addEventListener("click", () => navigateToDate(manifest.latestDate));
    els.datePicker.addEventListener("change", () => navigateToDateInput());
    els.datePicker.addEventListener("blur", () => {
      els.datePicker.value = formatDisplayDate(currentDate);
    });
    els.datePicker.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        navigateToDateInput();
        els.datePicker.blur();
      }
    });
    els.startReading.addEventListener("click", startReading);
    els.toggleAllExpanded.addEventListener("click", toggleAllExpanded);
    els.copyStarred.addEventListener("click", copyStarred);

    window.addEventListener("popstate", () => {
      const date = new URLSearchParams(location.search).get("date") || manifest.latestDate;
      loadDate(date, { replace: true });
    });
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`${path} を読み込めませんでした (${response.status})`);
    }
    return response.json();
  }

  async function loadDate(date, options = {}) {
    date = normalizeDateInput(date);
    if (!manifest.dates.includes(date)) {
      throw new Error(`${date} の記事データがありません`);
    }

    currentDate = date;
    currentData = await fetchJson(`data/${date}.json`);
    dayState = loadDayState(date);
    renderedArticles = new Map();
    els.articles.textContent = "";
    els.datePicker.value = date;
    syncUrl(date, options.replace);
    render();
  }

  function syncUrl(date, replace) {
    const url = new URL(location.href);
    url.searchParams.set("date", date);
    if (replace) {
      history.replaceState({ date }, "", url);
    } else {
      history.pushState({ date }, "", url);
    }
  }

  function loadDayState(date) {
    const fallback = { readingMode: false, articles: {} };
    try {
      return Object.assign(fallback, JSON.parse(localStorage.getItem(statePrefix + date)) || {});
    } catch (_error) {
      return fallback;
    }
  }

  function saveDayState() {
    localStorage.setItem(statePrefix + currentDate, JSON.stringify(dayState));
  }

  function articleState(article) {
    if (!dayState.articles[article.id]) {
      dayState.articles[article.id] = {
        expanded: false,
        selected: true,
      };
    }
    if (dayState.articles[article.id].selected === undefined) {
      dayState.articles[article.id].selected = true;
    }
    return dayState.articles[article.id];
  }

  function render() {
    els.pageTitle.textContent = currentDate;
    setButtonLabel(els.startReading, dayState.readingMode ? "一覧" : "読む");
    els.startReading.title = dayState.readingMode ? "全記事を表示して折りたたむ" : "チェックした記事を読む";
    els.copyStatus.textContent = "";

    const index = manifest.dates.indexOf(currentDate);
    els.prevDay.disabled = index >= manifest.dates.length - 1;
    els.nextDay.disabled = index <= 0;

    let visible = 0;
    let selected = 0;

    const nextRenderedArticles = new Map();
    els.articles.querySelector(".empty")?.remove();

    currentData.articles.forEach((article) => {
      const state = articleState(article);
      if (state.selected) selected += 1;
      if (!(dayState.readingMode && !state.selected)) visible += 1;
      let articleElement = renderedArticles.get(article.id);
      if (!articleElement) {
        articleElement = renderArticle(article, state);
      }
      updateArticle(articleElement, article, state);
      els.articles.appendChild(articleElement);
      nextRenderedArticles.set(article.id, articleElement);
    });

    renderedArticles.forEach((articleElement, id) => {
      if (!nextRenderedArticles.has(id)) {
        articleElement.remove();
      }
    });
    renderedArticles = nextRenderedArticles;

    if (!currentData.articles.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "この日の記事はありません。";
      els.articles.appendChild(empty);
    }

    const allExpanded = visibleArticles().length > 0 && visibleArticles().every(({ state }) => state.expanded);
    els.toggleAllExpanded.classList.toggle("is-collapse", allExpanded);
    els.toggleAllExpanded.title = allExpanded ? "全折りたたみ" : "全展開";
    els.toggleAllExpanded.setAttribute("aria-label", allExpanded ? "全折りたたみ" : "全展開");
    els.articleCount.textContent = `全${currentData.articles.length}件 / 表示中${visible}件 / 読む${selected}件`;
  }

  function renderArticle(article, state) {
    const fragment = els.template.content.cloneNode(true);
    const root = fragment.querySelector(".article");
    const title = fragment.querySelector(".title-button");
    const meta = fragment.querySelector(".meta");
    const body = fragment.querySelector(".article-text");
    const imageBox = fragment.querySelector(".article-images");
    const source = fragment.querySelector(".source-link");
    const selectArticle = fragment.querySelector(".select-article");
    const copyOne = fragment.querySelector(".copy-one");
    const collapseOne = fragment.querySelector(".collapse-one");
    const unselectOne = fragment.querySelector(".unselect-one");

    root.dataset.id = article.id;

    title.textContent = article.title;
    title.title = article.title;
    meta.textContent = article.category || "";
    body.textContent = (article.article || "").trimStart();
    source.href = article.url;

    article.images.forEach((image) => {
      const figure = document.createElement("figure");
      const img = document.createElement("img");
      const caption = document.createElement("figcaption");
      figure.className = "article-image";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = image.url;
      img.alt = image.caption || article.title;
      caption.textContent = image.caption || "";
      figure.appendChild(img);
      if (image.caption) figure.appendChild(caption);
      imageBox.appendChild(figure);
    });

    fragment.querySelector(".article-head").addEventListener("click", () => {
      state.expanded = !state.expanded;
      saveDayState();
      render();
    });
    selectArticle.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selected = !state.selected;
      saveDayState();
      render();
    });
    copyOne.addEventListener("click", (event) => {
      event.stopPropagation();
      copyMarkdown([article]);
    });
    collapseOne.addEventListener("click", () => {
      collapseArticle(root, state);
    });
    unselectOne.addEventListener("click", () => {
      const scrollTarget = findNextScrollTarget(root);
      const shouldScroll = shouldScrollAfterRemoval(root);
      state.selected = false;
      state.expanded = false;
      saveDayState();
      render();
      if (shouldScroll) {
        requestAnimationFrame(() => {
          scrollArticleToTop(scrollTarget);
        });
      }
    });

    updateArticle(root, article, state);
    return root;
  }

  function updateArticle(root, article, state) {
    const selectArticle = root.querySelector(".select-article");

    root.classList.toggle("is-expanded", state.expanded);
    root.classList.toggle("is-hidden", dayState.readingMode && !state.selected);

    selectArticle.classList.toggle("is-active", state.selected);
    selectArticle.title = state.selected ? "読む記事から外す" : "読む記事にする";
    selectArticle.setAttribute("aria-label", state.selected ? "読む記事から外す" : "読む記事にする");
  }

  function startReading() {
    dayState.readingMode = !dayState.readingMode;
    currentData.articles.forEach((article) => {
      const state = articleState(article);
      state.expanded = dayState.readingMode && state.selected;
    });
    saveDayState();
    render();
  }

  function toggleAllExpanded() {
    const articles = visibleArticles();
    const shouldExpand = articles.some(({ state }) => !state.expanded);
    articles.forEach(({ state }) => {
      state.expanded = shouldExpand;
    });
    saveDayState();
    render();
  }

  function visibleArticles() {
    return currentData.articles
      .map((article) => ({ article, state: articleState(article) }))
      .filter(({ state }) => !(dayState.readingMode && !state.selected));
  }

  function moveDate(offset) {
    const index = manifest.dates.indexOf(currentDate);
    const nextDate = manifest.dates[index + offset];
    if (nextDate) navigateToDate(nextDate);
  }

  function navigateToDate(date) {
    date = normalizeDateInput(date);
    if (!date || date === currentDate) return;
    loadDate(date);
  }

  function navigateToDateInput() {
    const date = normalizeDateInput(els.datePicker.value);
    if (!date) {
      els.copyStatus.textContent = "日付はYYYY-MM-DDで入力してください";
      return;
    }
    if (!manifest.dates.includes(date)) {
      els.copyStatus.textContent = `${date} の記事データがありません`;
      els.datePicker.value = currentDate;
      return;
    }
    navigateToDate(date);
  }

  function normalizeDateInput(value) {
    const match = String(value || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!match) return "";
    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setButtonLabel(button, label) {
    const labelNode = button.querySelector(".button-label");
    if (labelNode) {
      labelNode.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  function articleToMarkdown(article) {
    const imageMarkdown = article.images.map((image) => {
      const caption = image.caption || article.title;
      return `![${caption}](${image.url})`;
    }).join("\n\n");

    const lines = [
      `## ${article.title}`,
      "",
      `- Date: ${article.date}`,
      ...(article.category ? [`- Category: ${article.category}`] : []),
      `- URL: [${articleUrlId(article.url)}](${article.url})`,
      "",
      article.article || "",
      ...(imageMarkdown ? ["", imageMarkdown] : []),
    ];

    return lines.join("\n").trim();
  }

  function articleUrlId(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || url;
    } catch (_error) {
      return url;
    }
  }

  async function copyMarkdown(articles) {
    const text = articles.map(articleToMarkdown).join("\n\n---\n\n");
    const copied = await copyText(text);
    els.copyStatus.textContent = copied
      ? `${articles.length}件をコピーしました`
      : "コピーできませんでした。HTTPSまたはlocalhostで開いてください";
  }

  async function copyText(text) {
    const clipboard = window.navigator && window.navigator.clipboard;
    if (clipboard && window.isSecureContext) {
      try {
        await clipboard.writeText(text);
        return true;
      } catch (_error) {
        // Fall through to the selection-based fallback for iOS/Safari.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }

    return copied;
  }

  function collapseArticle(root, state) {
    const header = root.querySelector(".article-head");
    const headerRect = header.getBoundingClientRect();
    const stickyOffset = getStickyOffset();
    const headerVisible = headerRect.top >= stickyOffset && headerRect.bottom <= window.innerHeight;

    state.expanded = false;
    saveDayState();
    render();

    if (!headerVisible) {
      requestAnimationFrame(() => {
        scrollArticleToTop(root);
      });
    }
  }

  function shouldScrollAfterRemoval(root) {
    const header = root.querySelector(".article-head");
    const headerRect = header.getBoundingClientRect();
    const stickyOffset = getStickyOffset();
    return !(headerRect.top >= stickyOffset && headerRect.bottom <= window.innerHeight);
  }

  function findNextScrollTarget(root) {
    let next = root.nextElementSibling;
    while (next && next.classList.contains("is-hidden")) {
      next = next.nextElementSibling;
    }
    if (next) return next;

    let previous = root.previousElementSibling;
    while (previous && previous.classList.contains("is-hidden")) {
      previous = previous.previousElementSibling;
    }
    return previous;
  }

  function scrollArticleToTop(root) {
    if (!root) return;
    const top = root.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 8;
    window.scrollTo({ top: Math.max(0, top) });
  }

  function getStickyOffset() {
    const toolbar = document.querySelector(".toolbar")?.getBoundingClientRect().height || 0;
    if (window.matchMedia("(max-width: 720px)").matches) {
      return Math.ceil(toolbar + 12);
    }
    const header = document.querySelector(".app-header")?.getBoundingClientRect().height || 0;
    return Math.ceil(header + toolbar + 12);
  }

  function copyStarred() {
    const articles = visibleArticles().map(({ article }) => article);
    if (!articles.length) {
      els.copyStatus.textContent = "表示記事がありません";
      return;
    }
    copyMarkdown(articles);
  }

  function renderError(error) {
    els.pageTitle.textContent = "Error";
    els.articles.innerHTML = "";
    const box = document.createElement("div");
    box.className = "empty";
    box.textContent = error.message;
    els.articles.appendChild(box);
  }
})();
