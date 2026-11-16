(() => {
  "use strict";

  const EMAIL_RE = /^[a-z0-9._%+-]+@flame\.edu\.in$/i;
  const STORAGE_KEY = "lostfound.flame.user";
  const MAX_PHOTO_SOURCE = 12 * 1024 * 1024;
  const MAX_PHOTO_DIMENSION = 1400;
  const DICTATION_RESTARTS = 2;

  const state = {
    user: null,
    page: "feed",
    query: { q: "", status: "all", location: "all" },
    items: [],
    stats: { total: 0, lost: 0, found: 0, matches: 0, locations: 0 },
    matches: [],
    matchesLoaded: false,
    matchesError: false,
    boardLoaded: false,
    matchFilter: "all",
    reportType: "lost",
    photo: null,
    photoName: "",
    photoBytes: 0,
    photoBusy: false,
    isPosting: false,
    composerStage: "compose",
    activeField: "title",
    recognition: null,
    listening: false,
    dictationFinal: "",
    dictationInterim: "",
    dictationRestarts: 0,
    dictationStopping: false,
    dictationBusy: false,
    dictationTimer: 0,
    dictationError: "",
    dictationTarget: "title",
    loadingCount: 0,
    searchTimer: 0,
    feedAbort: null,
    authPending: null,
    authRequestId: 0,
    resetToken: null,
    resetEmail: null,
    contactItem: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const ids = [
    "navFeedCount", "navMatchCount", "sidebarItemCount", "footerItemCount",
    "profileButton", "profileAvatar", "profileName", "profileSub", "profileMenu",
    "menuName", "menuEmail", "signOutButton",
    "mobileAccountButton", "mobileAvatar", "mobileAccountMenu", "mobileMenuName",
    "mobileMenuEmail", "mobileSignOutButton",
    "feedSearch", "searchKbd", "searchClear",
    "reportForm", "itemTitle", "itemDescription", "itemLocation", "typeLost", "typeFound",
    "photoButton", "photoInput", "dictateButton", "dictateLabel", "dictationStrip",
    "dictationStatus", "dictationStop", "voiceStatus",
    "photoPreview", "photoPreviewImage", "photoPreviewMeta", "removePhotoButton",
    "reportButton", "reportButtonLabel",
    "countAll", "countLost", "countFound", "locationFilter",
    "resultsSummary", "feedGrid", "feedEmpty", "feedEmptyTitle", "feedEmptyCopy", "feedEmptyAction",
    "matchHeadCount", "matchAuthBanner", "matchSigninButton",
    "matchAllCount", "matchMineCount", "myMatchesTab", "matchSummary", "matchList",
    "matchEmpty", "matchEmptyTitle", "matchEmptyCopy", "matchEmptyAction",
    "authDialog", "authClose", "authContext", "authContextText", "authForm", "authEmail",
    "authInputShell", "authError", "authSubmit", "authSubmitLabel",
    "contactDialog", "contactClose", "contactTitle", "contactIntro", "contactBadge",
    "contactItemTitle", "contactEmail", "copyEmailButton", "contactMailLink",
    "toastRegion", "loadingBar",
  ];

  const dom = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  Object.assign(dom, {
    pageFeed: document.getElementById("page-feed"),
    pageMatches: document.getElementById("page-matches"),
    pagePrivacy: document.getElementById("page-privacy"),
    feedTitle: document.getElementById("feedTitle"),
    matchesTitle: document.getElementById("matchesTitle"),
    privacyTitle: document.getElementById("privacyTitle"),
    composerText: document.getElementById("composerText"),
    composerFields: document.getElementById("composerFields"),
    composerCapsule: document.getElementById("composerCapsule"),
    menuToggle: document.getElementById("menuToggle"),
    menuToggleMobile: document.getElementById("menuToggleMobile"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    customLocation: document.getElementById("customLocation"),
    customLocationWrap: document.getElementById("customLocationWrap"),
    authName: document.getElementById("authName"),
    authPassword: document.getElementById("authPassword"),
    authConfirm: document.getElementById("authConfirm"),
    passwordToggle: document.getElementById("passwordToggle"),
    forgotLink: document.getElementById("forgotLink"),
    authNameField: document.getElementById("authNameField"),
    authPasswordField: document.getElementById("authPasswordField"),
    authConfirmField: document.getElementById("authConfirmField"),
  });

  // -----------------------------------------------------------------------
  // Small helpers
  // -----------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setLoading(active) {
    state.loadingCount = Math.max(0, state.loadingCount + (active ? 1 : -1));
    if (dom.loadingBar) dom.loadingBar.hidden = state.loadingCount === 0;
  }

  function plural(count, singular, pluralForm = `${singular}s`) {
    return count === 1 ? singular : pluralForm;
  }

  function initialsFromName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((part) => part[0]).join("") || "FS").toUpperCase();
  }

  function nameFromEmail(email) {
    const local = String(email || "").split("@")[0];
    const words = local.split(/[._+-]+/).filter(Boolean);
    if (!words.length) return "Flame student";
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ").slice(0, 80);
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "there";
  }

  function normalizeUser(raw) {
    if (!raw || typeof raw !== "object") return null;
    const email = String(raw.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    const name = String(raw.name || "").trim() || nameFromEmail(email);
    const initials = String(raw.initials || "").trim().slice(0, 2).toUpperCase()
      || initialsFromName(name);
    return { email, name, initials };
  }

  function loadStoredUser() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeUser(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function persistUser(user) {
    try {
      if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      /* Storage can be unavailable; the session still works. */
    }
  }

  function timeAgo(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Recently";
    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fullDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function safeImageSrc(value) {
    if (typeof value !== "string") return null;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
    if (/^\/static\/img\/[a-z0-9._-]+\.(jpe?g|png|webp|gif)$/i.test(value)) return value;
    return null;
  }

  const CATEGORY_RULES = [
    { pattern: /backpack|\bbag\b/i, label: "Bag" },
    { pattern: /laptop|macbook|thinkpad|lenovo|computer/i, label: "Laptop" },
    { pattern: /iphone|phone|smartphone/i, label: "Phone" },
    { pattern: /airpod|earbud|headphone|earphone/i, label: "Earbuds" },
    { pattern: /bottle|flask/i, label: "Bottle" },
    { pattern: /student id|\bid\b|lanyard/i, label: "Student ID" },
    { pattern: /keyring|carabiner|\bkeys?\b/i, label: "Keys" },
    { pattern: /calculator/i, label: "Calculator" },
    { pattern: /glasses|spectacles/i, label: "Glasses" },
    { pattern: /umbrella/i, label: "Umbrella" },
    { pattern: /notebook|journal/i, label: "Notebook" },
    { pattern: /cycle|bicycle|\bbike\b/i, label: "Cycle" },
  ];

  function categoryFor(item) {
    const text = `${item.title || ""} ${item.description || ""}`;
    return CATEGORY_RULES.find((rule) => rule.pattern.test(text)) || { label: "Item" };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function hasActiveFilters() {
    return Boolean(state.query.q.trim())
      || state.query.status !== "all"
      || state.query.location !== "all";
  }

  // -----------------------------------------------------------------------
  // Profile UI
  // -----------------------------------------------------------------------

  function setAvatarContent(avatar, user) {
    if (!avatar) return;
    if (user) {
      avatar.classList.remove("avatar-guest");
      avatar.textContent = user.initials || initialsFromName(user.name);
    } else {
      avatar.classList.add("avatar-guest");
      avatar.textContent = "G";
    }
  }

  function updateProfileUI() {
    const user = state.user;

    if (user) {
      dom.profileButton.classList.add("is-signed-in");
      setAvatarContent(dom.profileAvatar, user);
      dom.profileName.textContent = user.name;
      dom.profileSub.textContent = user.email;
      dom.profileButton.setAttribute("aria-haspopup", "menu");
      dom.profileButton.setAttribute("aria-label", `Account menu for ${user.name}`);
      dom.menuName.textContent = user.name;
      dom.menuEmail.textContent = user.email;

      dom.mobileAccountButton.classList.remove("is-guest");
      dom.mobileAccountButton.classList.add("is-signed-in");
      setAvatarContent(dom.mobileAvatar, user);
      dom.mobileAccountButton.setAttribute("aria-label", `Account menu for ${user.name}`);
      dom.mobileAccountButton.setAttribute("aria-haspopup", "menu");
      dom.mobileMenuName.textContent = user.name;
      dom.mobileMenuEmail.textContent = user.email;
      dom.myMatchesTab.hidden = false;
      dom.matchAuthBanner.hidden = true;
    } else {
      dom.profileButton.classList.remove("is-signed-in");
      setAvatarContent(dom.profileAvatar, null);
      dom.profileName.textContent = "Guest";
      dom.profileSub.textContent = "Sign in with Flame";
      dom.profileButton.setAttribute("aria-haspopup", "dialog");
      dom.profileButton.setAttribute("aria-label", "Sign in with your Flame email");
      dom.profileButton.setAttribute("aria-expanded", "false");
      dom.menuName.textContent = "";
      dom.menuEmail.textContent = "";

      dom.mobileAccountButton.classList.add("is-guest");
      dom.mobileAccountButton.classList.remove("is-signed-in");
      setAvatarContent(dom.mobileAvatar, null);
      dom.mobileAccountButton.setAttribute("aria-label", "Sign in with your Flame email");
      dom.mobileAccountButton.setAttribute("aria-haspopup", "dialog");
      dom.mobileAccountButton.setAttribute("aria-expanded", "false");
      dom.mobileMenuName.textContent = "";
      dom.mobileMenuEmail.textContent = "";
      dom.myMatchesTab.hidden = true;
      dom.matchAuthBanner.hidden = false;
      closeMenus();
    }

    closeMenus();
    updateComposerState();
  }

  function setUser(user) {
    state.user = normalizeUser(user);
    persistUser(state.user);
    updateProfileUI();
  }

  function closeMenus() {
    dom.profileMenu.hidden = true;
    dom.mobileAccountMenu.hidden = true;
    dom.profileButton.setAttribute("aria-expanded", "false");
    dom.mobileAccountButton.setAttribute("aria-expanded", "false");
  }

  function openDrawer() {
    const sidebar = dom.sidebar || document.getElementById("sidebar");
    if (sidebar) sidebar.classList.add("is-open");
    if (dom.drawerBackdrop) dom.drawerBackdrop.classList.add("is-open");
    if (dom.drawerBackdrop) dom.drawerBackdrop.hidden = false;
    document.body.classList.add("drawer-open");
    [dom.menuToggle, dom.menuToggleMobile].forEach((button) => {
      if (button) button.setAttribute("aria-expanded", "true");
    });
  }

  function closeDrawer() {
    const sidebar = dom.sidebar || document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("is-open");
    if (dom.drawerBackdrop) dom.drawerBackdrop.classList.remove("is-open");
    if (dom.drawerBackdrop) dom.drawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    [dom.menuToggle, dom.menuToggleMobile].forEach((button) => {
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }

  function toggleDrawer() {
    const sidebar = dom.sidebar || document.getElementById("sidebar");
    if (sidebar && sidebar.classList.contains("is-open")) closeDrawer();
    else openDrawer();
  }

  // -----------------------------------------------------------------------
  // Pages
  // -----------------------------------------------------------------------

  function pageFromHash() {
    const hash = window.location.hash.replace("#", "").toLowerCase();
    if (hash === "matches") return "matches";
    if (hash === "privacy") return "privacy";
    const path = window.location.pathname.replace(/\/+$/, "").toLowerCase();
    if (path === "/privacy") return "privacy";
    return "feed";
  }

  function renderPage(page, { focus = false, scroll = true } = {}) {
    const target = page === "matches" || page === "privacy" ? page : "feed";
    state.page = target;

    const pages = {
      feed: dom.pageFeed,
      matches: dom.pageMatches,
      privacy: dom.pagePrivacy,
    };

    Object.entries(pages).forEach(([key, node]) => {
      const active = key === target;
      if (!node) return;
      node.hidden = !active;
      node.classList.toggle("is-active", active);
    });

    $$("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === target;
      if (link.classList.contains("nav-link") || link.classList.contains("mobile-nav-link")) {
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      } else {
        link.classList.toggle("is-active", active);
      }
    });

    const titles = {
      feed: "Campus feed, Lost & Found",
      matches: "Matches, Lost & Found",
      privacy: "Privacy, Lost & Found",
    };
    document.title = titles[target];

    closeMenus();
    if (typeof closeDrawer === "function") closeDrawer();
    if (target !== "feed") stopDictation();
    if (scroll) window.scrollTo(0, 0);

    if (focus) {
      const heading = target === "matches"
        ? dom.matchesTitle
        : target === "privacy"
          ? dom.privacyTitle
          : dom.feedTitle;
      window.requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }

  function goToPage(page, { focus = true, updateHistory = true } = {}) {
    const target = page === "matches" || page === "privacy" ? page : "feed";
    if (updateHistory && window.location.hash !== `#${target}`) {
      window.history.pushState({ page: target }, "", `#${target}`);
    }
    renderPage(target, { focus, scroll: true });
  }

  // -----------------------------------------------------------------------
  // Data
  // -----------------------------------------------------------------------

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("Could not reach the campus board. Check that the server is running.");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      throw new Error((data && data.error) || `Request failed (${response.status}).`);
    }
    return data;
  }

  function buildItemsURL() {
    const params = new URLSearchParams();
    const q = state.query.q.trim();
    if (q) params.set("q", q);
    if (state.query.status !== "all") params.set("status", state.query.status);
    if (state.query.location !== "all") params.set("location", state.query.location);
    const queryString = params.toString();
    return `/api/items${queryString ? `?${queryString}` : ""}`;
  }

  function buildMatchesURL(itemId = null) {
    const params = new URLSearchParams();
    if (state.user) params.set("email", state.user.email);
    if (itemId) params.set("item_id", String(itemId));
    const queryString = params.toString();
    return `/api/matches${queryString ? `?${queryString}` : ""}`;
  }

  function isOwnItem(item) {
    return Boolean(state.user)
      && String(item.reporter_email || "").toLowerCase() === state.user.email;
  }

  function matchInvolvesMe(match) {
    return isOwnItem(match.lost) || isOwnItem(match.found);
  }

  function updateStatsUI() {
    const stats = state.stats;
    if (dom.navFeedCount) dom.navFeedCount.textContent = stats.total;
    if (dom.navMatchCount) dom.navMatchCount.textContent = stats.matches;
    if (dom.sidebarItemCount) dom.sidebarItemCount.textContent = stats.total;
    if (dom.footerItemCount) dom.footerItemCount.textContent = stats.total;
    dom.countAll.textContent = stats.total;
    dom.countLost.textContent = stats.lost;
    dom.countFound.textContent = stats.found;
  }

  async function loadBoard({ initial = false } = {}) {
    if (initial) {
      dom.resultsSummary.textContent = "Loading reports";
      dom.matchSummary.textContent = "Loading matches";
      dom.matchHeadCount.textContent = "0";
    }

    setLoading(true);
    try {
      const [itemsData, statsData, matchesData] = await Promise.all([
        api(buildItemsURL()),
        api("/api/stats"),
        api(buildMatchesURL()),
      ]);

      state.items = Array.isArray(itemsData.items) ? itemsData.items : [];
      state.stats = statsData;
      state.matches = Array.isArray(matchesData.matches) ? matchesData.matches : [];
      state.matchesLoaded = true;
      state.matchesError = false;
      state.boardLoaded = true;

      updateStatsUI();
      renderFeed();
      renderMatches();
      return true;
    } catch (error) {
      if (!state.boardLoaded) {
        renderFeedFailure(error);
        renderMatchFailure(error);
      }
      showToast({
        title: initial ? "Couldn't load the board" : "Couldn't refresh the board",
        message: error.message,
        tone: "error",
        duration: 5200,
      });
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function loadItems() {
    if (state.feedAbort) state.feedAbort.abort();
    const controller = new AbortController();
    state.feedAbort = controller;

    dom.feedGrid.setAttribute("aria-busy", "true");
    dom.resultsSummary.textContent = state.query.q.trim() ? "Searching reports" : "Loading reports";
    setLoading(true);

    try {
      const data = await api(buildItemsURL(), { signal: controller.signal });
      if (controller.signal.aborted) return;
      state.items = Array.isArray(data.items) ? data.items : [];
      renderFeed();
    } catch (error) {
      if (error.name === "AbortError" || controller.signal.aborted) return;
      renderFeedFailure(error, true);
    } finally {
      if (state.feedAbort === controller) {
        state.feedAbort = null;
        dom.feedGrid.setAttribute("aria-busy", "false");
      }
      setLoading(false);
    }
  }

  function updateFilterControls() {
    $$("[data-status-filter]").forEach((button) => {
      const active = button.dataset.statusFilter === state.query.status;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    dom.locationFilter.value = state.query.location;
    dom.searchClear.hidden = !dom.feedSearch.value;
  }

  function resetFeedFilters() {
    state.query = { q: "", status: "all", location: "all" };
    dom.feedSearch.value = "";
    updateFilterControls();
  }

  function resultsLabel() {
    const count = state.items.length;
    if (!count) return "No reports found";
    let label = `${count} ${plural(count, "report")}`;
    const q = state.query.q.trim();
    if (q) label += ` for “${q}”`;
    return label;
  }

  // -----------------------------------------------------------------------
  // Feed rendering
  // -----------------------------------------------------------------------

  function buildPlaceholder(category) {
    const placeholder = el("div", "media-placeholder");
    const label = category.label || "Item";
    placeholder.append(
      el("span", "media-placeholder-mark", label.slice(0, 1).toUpperCase()),
      el("span", "media-placeholder-label", `${label}, no photo`),
    );
    return placeholder;
  }

  function buildMedia(item) {
    const category = categoryFor(item);
    const media = el("div", "item-media");
    const src = safeImageSrc(item.image);

    if (!src) {
      media.append(buildPlaceholder(category));
      return media;
    }

    const image = el("img");
    image.src = src;
    image.alt = `Photo of ${item.title}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => media.replaceChildren(buildPlaceholder(category)), { once: true });
    media.append(image);
    return media;
  }

  function buildItemCard(item) {
    const category = categoryFor(item);
    const card = el("article", "item-card");
    card.dataset.status = item.status;

    const body = el("div", "item-body");

    const meta = el("div", "card-meta");
    meta.append(
      el("span", `badge badge-${item.status}`, item.status),
      el("span", "card-category", category.label),
    );
    const time = el("time", "card-time", timeAgo(item.created_at));
    time.dateTime = item.created_at;
    time.title = fullDate(item.created_at);
    meta.append(time);

    const title = el("h3", "card-title", item.title);
    const description = el("p", "card-description", item.description || "No description added.");
    const foot = el("div", "card-foot");

    const location = el("span", "card-location", item.location);

    const reporter = el("span", "card-reporter");
    const miniAvatar = el("span", "mini-avatar", item.reporter_initials || initialsFromName(item.reporter_name));
    reporter.append(miniAvatar, el("span", "", item.reporter_name));

    foot.append(location, reporter);
    body.append(meta, title, description, foot);
    card.append(buildMedia(item), body);
    return card;
  }

  function renderFeed() {
    dom.feedGrid.replaceChildren();
    dom.feedGrid.setAttribute("aria-busy", "false");

    if (!state.items.length) {
      dom.feedGrid.hidden = true;
      if (hasActiveFilters()) {
        showFeedEmpty({
          title: "No reports found",
          copy: "Try a different word or clear the filters to see everything on the board.",
          actionLabel: "Clear filters",
          onAction: clearFeedFilters,
        });
      } else {
        showFeedEmpty({
          title: "No reports yet",
          copy: "The board is quiet. Start it off with the first thing you've lost or found.",
          actionLabel: "Write a report",
          onAction: () => dom.itemTitle.focus(),
        });
      }
      dom.resultsSummary.textContent = "No reports found";
      return;
    }

    dom.feedEmpty.hidden = true;
    dom.feedGrid.hidden = false;
    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
      const card = buildItemCard(item);
      card.style.setProperty("--i", String(Math.min(index, 8)));
      fragment.append(card);
    });
    dom.feedGrid.append(fragment);
    dom.resultsSummary.textContent = resultsLabel();
  }

  function showFeedEmpty({ title, copy, actionLabel = "Clear filters", onAction = null }) {
    dom.feedEmpty.hidden = false;
    dom.feedEmptyTitle.textContent = title;
    dom.feedEmptyCopy.textContent = copy;
    dom.feedEmptyAction.hidden = !actionLabel;
    dom.feedEmptyAction.textContent = actionLabel || "";
    dom.feedEmptyAction.onclick = onAction;
  }

  function clearFeedFilters() {
    resetFeedFilters();
    loadItems();
    dom.feedSearch.focus();
  }

  function renderFeedFailure(error, quiet = false) {
    dom.feedGrid.replaceChildren();
    dom.feedGrid.hidden = true;
    dom.feedGrid.setAttribute("aria-busy", "false");
    dom.resultsSummary.textContent = "Board unavailable";
    showFeedEmpty({
      title: "Couldn't load the board",
      copy: error && error.message ? error.message : "Something interrupted the request. Try once more.",
      actionLabel: "Try again",
      onAction: () => {
        if (state.boardLoaded) loadItems();
        else loadBoard({ initial: true });
      },
    });

    if (!quiet) {
      showToast({
        title: "Couldn't load the board",
        message: error && error.message ? error.message : "Please try again.",
        tone: "error",
        duration: 5000,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Matches
  // -----------------------------------------------------------------------

  function updateMatchControls() {
    const mineCount = state.matches.filter(matchInvolvesMe).length;
    dom.matchAllCount.textContent = state.matches.length;
    dom.matchMineCount.textContent = mineCount;
    dom.myMatchesTab.hidden = !state.user;
    $$("[data-match-filter]").forEach((button) => {
      const active = button.dataset.matchFilter === state.matchFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function buildMatchThumb(item) {
    const thumb = el("span", "match-thumb");
    const src = safeImageSrc(item.image);
    if (!src) {
      const label = categoryFor(item).label || "Item";
      thumb.append(el("span", "match-thumb-mark", label.slice(0, 1).toUpperCase()));
      return thumb;
    }
    const image = el("img");
    image.src = src;
    image.alt = `Photo of ${item.title}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      const label = categoryFor(item).label || "Item";
      thumb.replaceChildren(el("span", "match-thumb-mark", label.slice(0, 1).toUpperCase()));
    }, { once: true });
    thumb.append(image);
    return thumb;
  }

  function buildContactButton(item) {
    const button = el("button", "contact-button");
    button.type = "button";
    button.title = `Contact ${item.reporter_name}`;
    button.setAttribute("aria-label", `Contact ${item.reporter_name} about ${item.title}`);
    const icon = el("svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "11");
    icon.setAttribute("height", "11");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>';
    button.append(icon, el("span", "", "Contact"));
    button.addEventListener("click", () => requestContact(item));
    return button;
  }

  function buildMatchItem(item, match) {
    const mine = isOwnItem(item);
    const tile = el("div", `match-item${mine ? " is-mine" : ""}`);

    const body = el("div", "match-item-body");
    const top = el("div", "match-item-top");
    top.append(el("span", `badge badge-${item.status}`, item.status));
    if (mine) top.append(el("span", "match-you", "You"));

    const title = el("h3", "match-item-title", item.title);
    const meta = el("p", "match-item-meta");
    meta.append(
      el("span", "", item.reporter_name),
      el("span", "match-meta-sep", "·"),
      el("span", "", timeAgo(item.created_at)),
    );

    body.append(top, title, meta);
    tile.append(buildMatchThumb(item), body);
    if (!mine) tile.append(buildContactButton(item));
    return tile;
  }

  function buildMatchCard(match, index) {
    const card = el("article", "match-card");
    card.style.setProperty("--i", String(Math.min(index, 8)));

    const head = el("div", "match-card-head");
    const headLeft = el("div", "match-head-left");
    headLeft.append(
      el("span", "match-kicker", match.label || "Possible match"),
      el("span", "match-place", match.location),
    );

    const score = el("div", "match-score");
    score.title = `${match.score}% confidence`;
    score.append(el("strong", "", match.score), el("span", "", "%"));
    head.append(headLeft, score);

    const pair = el("div", "match-pair");
    const link = el("div", "match-link");
    link.append(
      el("span", "connector-line"),
      el("span", "connector-label", "Match"),
      el("span", "connector-line"),
    );

    pair.append(buildMatchItem(match.lost, match), link, buildMatchItem(match.found, match));

    const foot = el("div", "match-foot");
    (match.reasons || []).forEach((reason) => {
      const chip = el("span", "reason-chip", reason);
      foot.append(chip);
    });
    foot.append(el("span", "match-pair-id", `Pair ${String(index + 1).padStart(2, "0")}`));

    card.append(head, pair, foot);
    return card;
  }

  function showMatchEmpty({ title, copy, actionLabel = "Back to the feed", onAction = null }) {
    dom.matchList.hidden = true;
    dom.matchEmpty.hidden = false;
    dom.matchEmptyTitle.textContent = title;
    dom.matchEmptyCopy.textContent = copy;
    dom.matchEmptyAction.hidden = !actionLabel;
    dom.matchEmptyAction.textContent = actionLabel || "";
    dom.matchEmptyAction.onclick = onAction;
  }

  function renderMatches() {
    if (!state.matchesLoaded) return;
    dom.matchList.setAttribute("aria-busy", "false");

    if (!state.user && state.matchFilter === "mine") state.matchFilter = "all";
    updateMatchControls();
    dom.matchHeadCount.textContent = state.matches.length;

    const visible = state.matches.filter(
      (match) => state.matchFilter !== "mine" || matchInvolvesMe(match),
    );

    if (!state.matches.length) {
      dom.matchSummary.textContent = "No pairs yet";
      showMatchEmpty({
        title: "No matches yet",
        copy: "When two reports line up by location and detail, they will appear here automatically.",
        actionLabel: "Back to the feed",
        onAction: () => goToPage("feed"),
      });
      return;
    }

    if (!visible.length) {
      dom.matchSummary.textContent = "Nothing involving you";
      showMatchEmpty({
        title: "No matches involve you yet",
        copy: "Your reports are on the board. When another student posts something that lines up, this page will pair them.",
        actionLabel: "See all pairs",
        onAction: () => {
          state.matchFilter = "all";
          updateMatchControls();
          renderMatches();
        },
      });
      return;
    }

    dom.matchEmpty.hidden = true;
    dom.matchList.hidden = false;
    const fragment = document.createDocumentFragment();
    visible.forEach((match, index) => fragment.append(buildMatchCard(match, index)));
    dom.matchList.replaceChildren(fragment);

    dom.matchSummary.textContent = state.matchFilter === "mine"
      ? `${visible.length} ${plural(visible.length, "pair")} involving you`
      : `${visible.length} ${plural(visible.length, "pair")} · strongest first`;
  }

  function renderMatchFailure(error) {
    state.matchesLoaded = false;
    state.matchesError = true;
    dom.matchList.setAttribute("aria-busy", "false");
    dom.matchHeadCount.textContent = "0";
    dom.matchSummary.textContent = "Matches unavailable";
    showMatchEmpty({
      title: "Couldn't load matches",
      copy: error && error.message ? error.message : "The matching engine is unavailable right now.",
      actionLabel: "Try again",
      onAction: () => {
        refreshMatches();
      },
    });
  }

  // -----------------------------------------------------------------------
  // Toasts
  // -----------------------------------------------------------------------

  function showToast({
    title,
    message = "",
    tone = "info",
    duration = 4200,
    actionLabel = "",
    onAction = null,
  } = {}) {
    if (!dom.toastRegion || !title) return;

    const toast = el("div", `toast toast-${tone}`);
    toast.setAttribute("role", tone === "error" ? "alert" : "status");

    const main = el("div", "toast-main");
    main.append(el("p", "toast-title", title));
    if (message) main.append(el("p", "toast-message", message));

    let timer = 0;
    const dismiss = () => {
      if (!toast.isConnected || toast.classList.contains("is-leaving")) return;
      if (timer) window.clearTimeout(timer);
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 150);
    };

    if (actionLabel && typeof onAction === "function") {
      const action = el("button", "toast-action");
      action.type = "button";
      action.textContent = actionLabel;
      action.addEventListener("click", () => {
        dismiss();
        onAction();
      });
      main.append(action);
    }

    const close = el("button", "toast-close");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "Close";
    close.addEventListener("click", dismiss);

    toast.append(main, close);
    dom.toastRegion.append(toast);

    const toasts = $$(".toast", dom.toastRegion);
    if (toasts.length > 3) {
      toasts.slice(0, toasts.length - 3).forEach((stale) => stale.remove());
    }

    if (duration > 0) timer = window.setTimeout(dismiss, duration);
    return dismiss;
  }

  // -----------------------------------------------------------------------
  // Composer
  // -----------------------------------------------------------------------

  const ALLOWED_PHOTO_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
  const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
  let dictationBase = "";

  function updateComposerState() {
    const draftValue = state.composerStage === "compose"
      ? (dom.composerText ? dom.composerText.value : "")
      : (dom.itemTitle ? dom.itemTitle.value : "");
    const titleReady = draftValue.trim().length >= 2;
    const locationSelect = dom.itemLocation.value;
    const locationReady = locationSelect === "__other__"
      ? Boolean(dom.customLocation && dom.customLocation.value.trim())
      : Boolean(locationSelect);
    const disabled = !titleReady || !locationReady || state.isPosting || state.photoBusy;

    dom.reportButton.disabled = disabled;
    dom.reportButton.setAttribute("aria-disabled", String(disabled));
    dom.reportButton.classList.toggle("is-active", titleReady);

    if (dom.composerFields) dom.composerFields.hidden = state.composerStage === "compose";

    dom.photoButton.setAttribute("aria-pressed", String(Boolean(state.photo)));
    dom.photoButton.classList.toggle("is-busy", state.photoBusy);
    dom.dictateButton.setAttribute("aria-pressed", String(state.listening));
  }

  function setReportType(type) {
    state.reportType = type === "found" ? "found" : "lost";
    const lost = state.reportType === "lost";
    dom.typeLost.classList.toggle("is-active", lost);
    dom.typeFound.classList.toggle("is-active", !lost);
    dom.typeLost.setAttribute("aria-pressed", String(lost));
    dom.typeFound.setAttribute("aria-pressed", String(!lost));
  }

  function autoGrowDescription() {
    dom.itemDescription.style.height = "auto";
    dom.itemDescription.style.height = `${Math.min(dom.itemDescription.scrollHeight, 140)}px`;
  }

  function autoGrowComposerText() {
    if (!dom.composerText) return;
    dom.composerText.style.height = "auto";
    dom.composerText.style.height = `${Math.min(dom.composerText.scrollHeight, 120)}px`;
  }

  function resetComposer() {
    if (state.listening) stopDictation();
    dom.reportForm.reset();
    state.photo = null;
    state.photoName = "";
    state.photoBytes = 0;
    state.photoBusy = false;
    state.composerStage = "compose";

    dom.photoPreview.hidden = true;
    dom.photoPreviewImage.removeAttribute("src");
    dom.photoPreviewMeta.textContent = "";
    dom.photoInput.value = "";
    dom.photoButton.classList.remove("is-busy");
    dom.photoButton.setAttribute("aria-pressed", "false");
    if (dom.customLocation) dom.customLocation.value = "";
    if (dom.customLocationWrap) dom.customLocationWrap.hidden = true;

    setReportType("lost");
    autoGrowDescription();
    autoGrowComposerText();
    updateComposerState();
  }

  function encodedBytes(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
    return Math.floor((base64.length * 3) / 4);
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("That image could not be read. Try a JPG or PNG."));
      };
      image.src = objectUrl;
    });
  }

  async function compressPhoto(file) {
    const image = await loadImageFile(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const longestSide = Math.max(sourceWidth, sourceHeight);
    if (!sourceWidth || !sourceHeight) {
      throw new Error("That image could not be read. Try another photo.");
    }

    let scale = Math.min(1, MAX_PHOTO_DIMENSION / longestSide);
    let dataUrl = "";
    let bytes = 0;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not process that photo.");

      context.fillStyle = "#141414";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      dataUrl = canvas.toDataURL("image/jpeg", Math.max(0.5, 0.82 - attempt * 0.1));
      bytes = encodedBytes(dataUrl);
      if (bytes <= MAX_PHOTO_BYTES) return { dataUrl, bytes };
      scale *= 0.7;
    }

    throw new Error("That photo is still too large. Try a smaller image.");
  }

  async function handlePhotoFile(file) {
    if (!file || state.photoBusy) return;

    const looksLikeImage = ALLOWED_PHOTO_TYPES.has(file.type)
      || /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");

    if (!looksLikeImage) {
      showToast({
        title: "That file isn't a photo",
        message: "Use a PNG, JPG, WEBP, or GIF image.",
        tone: "error",
      });
      dom.photoInput.value = "";
      return;
    }

    if (file.size > MAX_PHOTO_SOURCE) {
      showToast({
        title: "That photo is too large",
        message: "Pick an image under 12 MB. It will be compressed before posting.",
        tone: "error",
      });
      dom.photoInput.value = "";
      return;
    }

    state.photoBusy = true;
    updateComposerState();

    try {
      const result = await compressPhoto(file);
      state.photo = result.dataUrl;
      state.photoName = file.name || "Campus photo";
      state.photoBytes = result.bytes;

      dom.photoPreviewImage.src = result.dataUrl;
      dom.photoPreviewMeta.textContent = `${state.photoName} · ${formatBytes(result.bytes)}`;
      dom.photoPreview.hidden = false;

      showToast({
        title: "Photo attached",
        message: `${formatBytes(result.bytes)} after compression.`,
        tone: "success",
        duration: 2600,
      });
    } catch (error) {
      showToast({
        title: "Couldn't attach that photo",
        message: error.message,
        tone: "error",
      });
    } finally {
      state.photoBusy = false;
      dom.photoInput.value = "";
      updateComposerState();
    }
  }

  function removeComposerPhoto() {
    state.photo = null;
    state.photoName = "";
    state.photoBytes = 0;
    dom.photoPreview.hidden = true;
    dom.photoPreviewImage.removeAttribute("src");
    dom.photoPreviewMeta.textContent = "";
    dom.photoInput.value = "";
    dom.photoButton.setAttribute("aria-pressed", "false");
    updateComposerState();
  }

  async function handleComposerSubmit() {
    if (state.isPosting) return;
    const text = (dom.composerText ? dom.composerText.value : "").replace(/\s+/g, " ").trim();

    if (text.length < 2) {
      showToast({
        title: "Add a few words",
        message: "Describe what you lost or found, then submit.",
        tone: "error",
      });
      if (dom.composerText) dom.composerText.focus();
      return;
    }

    if (state.photoBusy) {
      showToast({
        title: "Photo still processing",
        message: "Give it a second, then submit.",
        tone: "info",
      });
      return;
    }

    state.isPosting = true;
    if (state.listening) stopDictation();
    dom.reportForm.setAttribute("aria-busy", "true");
    updateComposerState();

    try {
      const data = await api("/api/refine", {
        method: "POST",
        body: JSON.stringify({ transcript: text, status: state.reportType }),
      });
      applyRefinedReport(data);
      showToast({
        title: "Details ready",
        message: data && data.note ? data.note : "Review them before publishing.",
        tone: "info",
        duration: 4200,
      });
      if (dom.itemTitle) dom.itemTitle.focus({ preventScroll: true });
    } catch (error) {
      applyLocalTranscript(text);
      state.composerStage = "review";
      dom.itemTitle.value = text.slice(0, 120);
      dom.itemDescription.value = text;
      if (dom.itemLocation.value === "") dom.itemLocation.focus();
      showToast({
        title: "Refiner was offline",
        message: "Filled from your words. Give it a quick read.",
        tone: "info",
        duration: 5600,
      });
    } finally {
      state.isPosting = false;
      dom.reportForm.removeAttribute("aria-busy");
      updateComposerState();
    }
  }

  async function submitReport() {
    if (state.isPosting) return;

    if (state.photoBusy) {
      showToast({
        title: "Photo still processing",
        message: "Give it a second, then report the item.",
        tone: "info",
      });
      return;
    }

    const title = dom.itemTitle.value.replace(/\s+/g, " ").trim();
    const description = dom.itemDescription.value.trim();
    const locationSelect = dom.itemLocation.value;
    const location = locationSelect === "__other__"
      ? (dom.customLocation ? dom.customLocation.value.trim() : "")
      : locationSelect;

    if (title.length < 2) {
      showToast({
        title: "Add an item title",
        message: "A few words about the item is enough.",
        tone: "error",
      });
      dom.itemTitle.focus();
      return;
    }

    if (!location) {
      showToast({
        title: "Choose a location",
        message: "Where was the item lost or found?",
        tone: "error",
      });
      dom.itemLocation.focus();
      return;
    }

    if (!state.user) {
      openAuth({
        context: "Sign in with your Flame email to publish this report.",
        pending: { type: "submit" },
      });
      return;
    }

    state.isPosting = true;
    stopDictation();
    dom.reportForm.setAttribute("aria-busy", "true");
    updateComposerState();

    try {
      const data = await api("/api/items", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          location,
          status: state.reportType,
          reporter_email: state.user.email,
          image: state.photo,
        }),
      });

      const matchCount = Number(data.match_count) || 0;
      const published = data.item && data.item.status === "found"
        ? "Found report published"
        : "Lost report published";

      resetComposer();
      showToast({
        title: published,
        message: matchCount
          ? `${matchCount} potential ${plural(matchCount, "match", "matches")} found on campus. Take a look.`
          : "It's live on the campus board now.",
        tone: "success",
        duration: matchCount ? 7200 : 4200,
        actionLabel: matchCount ? "View matches" : "",
        onAction: matchCount
          ? () => {
            goToPage("matches");
            refreshMatches();
          }
          : null,
      });

      await loadBoard();
    } catch (error) {
      showToast({
        title: "Couldn't publish the report",
        message: error.message,
        tone: "error",
        duration: 5600,
      });
    } finally {
      state.isPosting = false;
      dom.reportForm.removeAttribute("aria-busy");
      updateComposerState();
    }
  }

  // -----------------------------------------------------------------------
  // Dictation
  // -----------------------------------------------------------------------

  const LOCATION_NAMES = ["Library", "Canteen", "Classroom", "Dorm", "Lab", "Gym", "Parking"];

  function speechRecognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function dictationTarget() {
    return dom.composerText;
  }

  function setVoiceStatus(message = "", tone = "") {
    if (!dom.voiceStatus) return;
    dom.voiceStatus.hidden = !message;
    dom.voiceStatus.textContent = message;
    if (tone) dom.voiceStatus.dataset.tone = tone;
    else delete dom.voiceStatus.dataset.tone;
  }

  function updateDictationUI() {
    if (dom.dictateButton) {
      dom.dictateButton.setAttribute("aria-pressed", String(state.listening));
      dom.dictateButton.classList.toggle("is-listening", state.listening);
    }
    const stripVisible = state.listening || state.dictationBusy;
    if (dom.dictationStrip) {
      dom.dictationStrip.hidden = !stripVisible;
      dom.dictationStrip.classList.toggle("is-busy", state.dictationBusy);
    }
    if (dom.dictationStop) dom.dictationStop.hidden = !state.listening;

    if (state.listening) {
      if (dom.dictateLabel) dom.dictateLabel.textContent = "Stop";
      const heard = `${state.dictationFinal} ${state.dictationInterim}`.replace(/\s+/g, " ").trim();
      if (dom.dictationStatus) {
        dom.dictationStatus.textContent = heard
          ? `Listening. ${heard}`
          : "Listening. Speak naturally.";
      }
    } else if (dom.dictateLabel) {
      dom.dictateLabel.textContent = "Voice";
    }
  }

  function speechErrorMessage(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access is blocked. Allow the mic in this site's settings, then try again.";
      case "no-speech":
        return "I didn't catch that. Move a little closer to the mic and try again.";
      case "audio-capture":
        return "No microphone was found on this device.";
      case "network":
        return "Chrome's speech service is unreachable. Check your connection, or type the report instead.";
      default:
        return "Voice input stopped. You can type the rest instead.";
    }
  }

  function micPermissionMessage(error) {
    switch (error && error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "Microphone access is blocked. Allow the mic in this site's settings, then try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No microphone was found on this device.";
      case "NotReadableError":
      case "TrackStartError":
        return "Another app is using the microphone. Close it and try again.";
      default:
        return "The microphone could not be opened. Type your report instead.";
    }
  }

  async function ensureMicrophoneAccess() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      setVoiceStatus(micPermissionMessage(error), "error");
      showToast({
        title: "Microphone unavailable",
        message: micPermissionMessage(error),
        tone: "error",
        duration: 5600,
      });
      return false;
    }
  }

  function stopRecognition() {
    const recognition = state.recognition;
    state.recognition = null;
    state.listening = false;
    state.dictationStopping = false;
    window.clearTimeout(state.dictationTimer);
    state.dictationTimer = 0;

    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch (error) {
        try {
          recognition.stop();
        } catch (innerError) {
          /* Already stopped. */
        }
      }
    }

    updateDictationUI();
    updateComposerState();
  }

  function resetDictationState() {
    state.dictationFinal = "";
    state.dictationInterim = "";
    state.dictationRestarts = 0;
    state.dictationStopping = false;
    window.clearTimeout(state.dictationTimer);
    state.dictationTimer = 0;
  }

  function cancelDictation() {
    stopRecognition();
    resetDictationState();
    dictationBase = "";
    dom.dictationStatus.textContent = "Listening. Speak naturally.";
  }

  function beginRecognition(Recognition) {
    let recognition;
    try {
      recognition = new Recognition();
    } catch (error) {
      setVoiceStatus("Voice input is unavailable in this browser right now.", "error");
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    state.dictationError = "";

    recognition.onstart = () => {
      state.listening = true;
      updateDictationUI();
      updateComposerState();
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const chunk = result[0] && result[0].transcript ? result[0].transcript : "";
        if (result.isFinal) finalText += `${chunk} `;
        else interimText += chunk;
      }

      state.dictationFinal = finalText.replace(/\s+/g, " ").trim();
      state.dictationInterim = interimText.replace(/\s+/g, " ").trim();
      state.dictationError = "";
      updateDictationUI();

      window.clearTimeout(state.dictationTimer);
      if (state.dictationFinal.length >= 2) {
        state.dictationTimer = window.setTimeout(() => finishDictation(), 2800);
      }
    };

    recognition.onerror = (event) => {
      if (state.dictationStopping) return;
      state.dictationError = event.error || "unknown";
      if (event.error === "aborted") return;
      if (event.error === "no-speech") return;
      setVoiceStatus(speechErrorMessage(event.error), "error");
    };

    recognition.onend = () => {
      if (state.recognition !== recognition) return;
      state.recognition = null;
      state.listening = false;
      updateDictationUI();
      updateComposerState();

      if (state.dictationStopping) {
        state.dictationStopping = false;
        finishDictation();
        return;
      }

      const hasText = `${state.dictationFinal} ${state.dictationInterim}`.trim().length > 1;
      if (hasText) {
        finishDictation();
        return;
      }

      if (state.dictationError === "no-speech" && state.dictationRestarts < DICTATION_RESTARTS) {
        state.dictationRestarts += 1;
        window.setTimeout(() => {
          if (!state.listening && !state.dictationBusy) beginRecognition(Recognition);
        }, 320);
        return;
      }

      if (state.dictationError && state.dictationError !== "no-speech") return;
      setVoiceStatus("I didn't hear anything. Try the mic again, a little closer.", "error");
      dom.dictationStrip.hidden = true;
    };

    state.recognition = recognition;
    state.listening = true;
    updateDictationUI();
    updateComposerState();

    try {
      recognition.start();
    } catch (error) {
      state.recognition = null;
      state.listening = false;
      updateDictationUI();
      updateComposerState();
      dom.dictationStrip.hidden = true;
      setVoiceStatus("The mic is already starting. Give it a second, then try again.", "error");
    }
  }

  async function startDictation() {
    if (state.dictationBusy) return;
    if (state.listening) {
      finishDictation();
      return;
    }

    const Recognition = speechRecognitionClass();
    if (!Recognition) {
      showToast({
        title: "Dictation isn't available",
        message: "Chrome and Edge support voice input. You can still type your report.",
        tone: "error",
      });
      return;
    }

    if (!window.isSecureContext) {
      showToast({
        title: "The mic needs a secure page",
        message: "Open the board on localhost or HTTPS, then try the mic again.",
        tone: "error",
      });
      return;
    }

    resetDictationState();
    setVoiceStatus("");
    dom.dictationStatus.textContent = "Checking the microphone";
    dom.dictationStrip.hidden = false;

    const permitted = await ensureMicrophoneAccess();
    if (!permitted) {
      dom.dictationStrip.hidden = true;
      return;
    }

    dictationBase = dictationTarget().value.trim();
    state.dictationTarget = state.activeField;
    dom.dictationStatus.textContent = "Listening. Speak naturally.";
    beginRecognition(Recognition);
  }

  function refinedTitleFallback(text) {
    let title = text
      .replace(/^(?:so\s+|okay\s+|ok\s+|yeah\s+)?(?:i\s+)?(?:think\s+)?(?:i\s+)?(?:have\s+)?(?:lost|found|misplaced)\s+(?:my\s+|a\s+|an\s+|the\s+)?/i, "")
      .replace(/^(?:my|a|an|the)\s+/i, "")
      .split(/[.!?]/)[0]
      .split(/\b(?:at|in|near|outside|inside|from|on)\b/i)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (!title) title = text.trim();
    if (title.length > 90) title = title.slice(0, 90);
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  function applyLocalTranscript(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (dom.composerText) {
      dom.composerText.value = clean;
      autoGrowComposerText();
    }
    updateComposerState();
  }

  function applyRefinedReport(data) {
    if (!data || typeof data !== "object") return false;

    const title = String(data.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const description = String(data.description || "").trim().slice(0, 800);
    const status = data.status === "found" ? "found" : "lost";
    const location = LOCATION_NAMES.includes(data.location) ? data.location : "";

    if (title) dom.itemTitle.value = title;
    dom.itemDescription.value = description;
    setReportType(status);
    if (location) {
      const optionExists = [...dom.itemLocation.options].some((o) => o.value === location);
      if (optionExists) {
        dom.itemLocation.value = location;
      } else {
        dom.itemLocation.value = "__other__";
        if (dom.customLocation) dom.customLocation.value = location;
        if (dom.customLocationWrap) dom.customLocationWrap.hidden = false;
      }
    }
    autoGrowDescription();
    state.composerStage = "review";
    updateComposerState();
    return Boolean(title);
  }

  async function finishDictation() {
    if (state.dictationBusy) return;

    const transcript = `${state.dictationFinal} ${state.dictationInterim}`
      .replace(/\s+/g, " ")
      .trim();
    const baseText = dictationBase;
    const combined = [baseText, transcript].filter(Boolean).join(". ").trim();

    stopRecognition();
    resetDictationState();

    if (!combined) {
      setVoiceStatus("I didn't hear anything. Try the mic again, a little closer.", "error");
      dom.dictationStrip.hidden = true;
      return;
    }

    state.dictationBusy = true;
    dom.dictationStrip.hidden = false;
    dom.dictationStop.hidden = true;
    dom.dictationStatus.textContent = "Tidying your words into a report";
    setVoiceStatus("");
    updateDictationUI();
    updateComposerState();

    try {
      const data = await api("/api/refine", {
        method: "POST",
        body: JSON.stringify({ transcript: combined, status: state.reportType }),
      });
      applyRefinedReport(data);
      const source = data && data.source === "openai" ? "Refined" : "Tidied";
      setVoiceStatus(`${source} into a title and description. Edit anything before posting.`, "success");
      dom.itemTitle.focus({ preventScroll: true });
    } catch (error) {
      applyLocalTranscript(combined);
      setVoiceStatus("Filled from your transcript. The refiner was offline, so give it a quick read.", "info");
      dom.itemTitle.focus({ preventScroll: true });
    } finally {
      state.dictationBusy = false;
      dom.dictationStrip.hidden = true;
      dom.dictationStrip.classList.remove("is-busy");
      updateDictationUI();
      updateComposerState();
    }
  }

  function stopDictation() {
    cancelDictation();
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  let authSubmitting = false;

  function syncModalBody() {
    const anyOpen = $$("dialog[open]").length > 0;
    document.body.classList.toggle("modal-open", anyOpen);
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    syncModalBody();
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    syncModalBody();
  }

  function setAuthError(message = "") {
    const hasError = Boolean(message);
    dom.authError.hidden = !hasError;
    dom.authError.textContent = message;
    if (hasError) {
      dom.authEmail.setAttribute("aria-invalid", "true");
    } else {
      dom.authEmail.removeAttribute("aria-invalid");
    }
    dom.authInputShell.classList.toggle("has-error", hasError);
  }

  function setAuthMode(mode) {
    const isRegister = mode === "register";
    $$("[data-auth-mode]").forEach((button) => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (dom.authNameField) dom.authNameField.hidden = !isRegister;
    if (dom.authConfirmField) dom.authConfirmField.hidden = !isRegister;
    if (dom.authTitle) dom.authTitle.textContent = isRegister ? "Create your Flame account." : "Sign in with Flame.";
    if (dom.authSubmitLabel) dom.authSubmitLabel.textContent = isRegister ? "Create account" : "Sign in";
    if (dom.authPassword) {
      dom.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    }
    setAuthError("");
  }

  function openAuth({ context = "", pending = null, mode = "login" } = {}) {
    state.authPending = pending;
    const message = context
      || (pending && pending.type === "contact" && pending.item
        ? `Sign in to contact ${pending.item.reporter_name} about this report.`
        : "Sign in to publish reports and contact reporters.");

    dom.authContext.hidden = !message;
    dom.authContextText.textContent = message || "";
    dom.authEmail.value = (mode === "reset" && state.resetEmail) ? state.resetEmail : "";
    if (dom.authEmail) dom.authEmail.readOnly = (mode === "reset");
    if (dom.authName) dom.authName.value = "";
    if (dom.authPassword) dom.authPassword.value = "";
    if (dom.authConfirm) dom.authConfirm.value = "";
    setAuthError("");
    authSubmitting = false;
    dom.authSubmit.disabled = false;
    if (mode === "reset") {
      if (dom.authNameField) dom.authNameField.hidden = true;
      if (dom.authPasswordField) dom.authPasswordField.hidden = false;
      if (dom.authConfirmField) dom.authConfirmField.hidden = false;
      const toggle = document.querySelector(".auth-mode-toggle");
      if (toggle) toggle.hidden = true;
      if (dom.authSubmitLabel) dom.authSubmitLabel.textContent = "Reset password";
    } else {
      const toggle = document.querySelector(".auth-mode-toggle");
      if (toggle) toggle.hidden = false;
      setAuthMode(mode);
    }
    openDialog(dom.authDialog);
    window.requestAnimationFrame(() => (mode === "reset" ? dom.authPassword : dom.authEmail).focus({ preventScroll: true }));
  }

  function closeAuthDialog() {
    closeDialog(dom.authDialog);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (authSubmitting) return;

    // Password reset flow (opened via email link)
    if (state.resetToken && state.resetEmail) {
      const password = dom.authPassword ? dom.authPassword.value : "";
      const confirm = dom.authConfirm ? dom.authConfirm.value : "";
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setAuthError("Password must be at least 8 characters with a letter and a number.");
        return;
      }
      if (password !== confirm) {
        setAuthError("Passwords do not match.");
        return;
      }
      authSubmitting = true;
      dom.authSubmit.disabled = true;
      dom.authSubmitLabel.textContent = "Resetting";
      setAuthError("");
      try {
        await api("/api/auth/reset", {
          method: "POST",
          body: JSON.stringify({ email: state.resetEmail, token: state.resetToken, password }),
        });
        state.resetToken = null;
        state.resetEmail = null;
        authSubmitting = false;
        dom.authSubmit.disabled = false;
        dom.authSubmitLabel.textContent = "Sign in";
        showToast({ title: "Password reset", message: "You can sign in with your new password.", tone: "success", duration: 6000 });
        closeAuthDialog();
      } catch (error) {
        authSubmitting = false;
        dom.authSubmit.disabled = false;
        dom.authSubmitLabel.textContent = "Reset password";
        setAuthError(error.message || "Reset failed.");
      }
      return;
    }

    const mode = ($$("[data-auth-mode]").find((b) => b.classList.contains("is-active")) || {}).dataset?.authMode || "login";
    const email = dom.authEmail.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setAuthError("Use your Flame email. It must end in @flame.edu.in.");
      showToast({ title: "That isn't a Flame address", message: "Try something like name@flame.edu.in.", tone: "error" });
      return;
    }

    authSubmitting = true;
    dom.authSubmit.disabled = true;
    dom.authSubmitLabel.textContent = mode === "register" ? "Creating account" : "Signing in";
    setAuthError("");

    try {
      if (mode === "register") {
        const name = (dom.authName ? dom.authName.value : "").trim();
        const password = dom.authPassword ? dom.authPassword.value : "";
        const confirm = dom.authConfirm ? dom.authConfirm.value : "";
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          throw new Error("Password must be at least 8 characters with a letter and a number.");
        }
        if (password !== confirm) {
          throw new Error("Passwords do not match.");
        }
        const data = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, name, password }),
        });
        authSubmitting = false;
        dom.authSubmit.disabled = false;
        dom.authSubmitLabel.textContent = "Create account";
        if (data.email_sent) {
          showToast({ title: "Verification sent", message: `Check ${email} for a verification link.`, tone: "success", duration: 6000 });
        } else {
          showToast({ title: "Account created", message: "Email delivery is not configured; contact the maintainer to verify.", tone: "info", duration: 7000 });
        }
        closeAuthDialog();
        return;
      }

      const password = dom.authPassword ? dom.authPassword.value : "";
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const pending = state.authPending;
      state.authPending = null;
      authSubmitting = false;

      setUser(data.user);
      closeAuthDialog();
      await refreshMatches();

      const mineCount = state.matches.filter(matchInvolvesMe).length;
      showToast({
        title: `Signed in as ${data.user.name}`,
        message: mineCount
          ? `${data.user.email} · ${mineCount} ${plural(mineCount, "match", "matches")} involve your reports.`
          : data.user.email,
        tone: "success",
      });

      if (pending && pending.type === "contact" && pending.item) {
        requestContact(pending.item);
      } else if (pending && pending.type === "submit") {
        submitReport();
      }
    } catch (error) {
      authSubmitting = false;
      dom.authSubmit.disabled = false;
      dom.authSubmitLabel.textContent = mode === "register" ? "Create account" : "Sign in";
      setAuthError(error.message || "Authentication failed.");
      showToast({ title: "Authentication failed", message: error.message, tone: "error", duration: 5600 });
    }
  }

  function signOut() {
    if (!state.user) return;
    const name = state.user.name;
    setUser(null);
    state.matchFilter = "all";
    closeMenus();
    renderMatches();
    showToast({
      title: "Signed out",
      message: `${firstName(name)}, your reports stay on the board.`,
      tone: "info",
    });
    refreshMatches();
  }

  async function refreshMatches() {
    setLoading(true);
    try {
      const data = await api(buildMatchesURL());
      state.matches = Array.isArray(data.matches) ? data.matches : [];
      state.matchesLoaded = true;
      state.matchesError = false;
      updateMatchControls();
      renderMatches();
      return true;
    } catch (error) {
      state.matchesError = true;
      if (!state.matchesLoaded) renderMatchFailure(error);
      return false;
    } finally {
      setLoading(false);
    }
  }

  // -----------------------------------------------------------------------
  // Contact
  // -----------------------------------------------------------------------

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* Use the selection fallback below. */
    }

    const area = el("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.append(area);
    area.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    area.remove();
    return copied;
  }

  function resetCopyButton() {
    const label = document.getElementById("copyEmailLabel");
    if (label) label.textContent = "Copy";
    dom.copyEmailButton.classList.remove("is-copied");
  }

  function requestContact(item) {
    if (!item) return;

    if (!state.user) {
      openAuth({
        context: `Sign in to contact ${item.reporter_name} about this report.`,
        pending: { type: "contact", item },
      });
      return;
    }

    if (isOwnItem(item)) {
      showToast({
        title: "That's your report",
        message: "It was posted with your Flame email, so there's no one to contact.",
        tone: "info",
      });
      return;
    }

    const email = String(item.reporter_email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      showToast({
        title: "Contact unavailable",
        message: "This report doesn't have a reachable campus email.",
        tone: "error",
      });
      return;
    }

    state.contactItem = item;
    const status = item.status === "found" ? "found" : "lost";

    dom.contactIntro.textContent = `Email ${item.reporter_name} about this ${status} report. Mention a detail only the owner would know.`;
    dom.contactBadge.className = `badge badge-${status}`;
    dom.contactBadge.textContent = status;
    dom.contactItemTitle.textContent = item.title;
    dom.contactEmail.textContent = email;

    const subject = `Lost & Found: ${item.title}`;
    const body = [
      `Hi ${firstName(item.reporter_name)},`,
      "",
      `I'm reaching out from the Flame Lost & Found board about your ${status} report: "${item.title}".`,
      "",
      "I think we might be talking about the same item. Is it still with you?",
      "",
      `Thanks,\n${state.user.name}`,
    ].join("\n");

    dom.contactMailLink.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const mailLabel = dom.contactMailLink.querySelector("span");
    if (mailLabel) mailLabel.textContent = `Email ${firstName(item.reporter_name)}`;

    resetCopyButton();
    openDialog(dom.contactDialog);
  }

  async function copyContactEmail() {
    const email = state.contactItem ? state.contactItem.reporter_email : "";
    if (!email) return;

    const copied = await copyText(email);
    if (!copied) {
      showToast({
        title: "Couldn't copy the email",
        message: "Select the address and copy it manually.",
        tone: "error",
      });
      return;
    }

    const label = document.getElementById("copyEmailLabel");
    if (label) label.textContent = "Copied";
    dom.copyEmailButton.classList.add("is-copied");
    showToast({
      title: "Email copied",
      message: email,
      tone: "success",
      duration: 2400,
    });
    window.setTimeout(resetCopyButton, 2000);
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  function bindEvents() {
    $$("[data-nav]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        goToPage(link.dataset.nav);
      });
    });

    window.addEventListener("hashchange", () => renderPage(pageFromHash(), { scroll: true }));
    window.addEventListener("popstate", () => renderPage(pageFromHash(), { scroll: true }));

    dom.profileButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.user) {
        openAuth({ context: "Sign in to publish reports and contact reporters." });
        return;
      }
      const shouldOpen = dom.profileMenu.hidden;
      closeMenus();
      if (shouldOpen) {
        dom.profileMenu.hidden = false;
        dom.profileButton.setAttribute("aria-expanded", "true");
      }
    });

    dom.mobileAccountButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.user) {
        openAuth({ context: "Sign in to publish reports and contact reporters." });
        return;
      }
      const shouldOpen = dom.mobileAccountMenu.hidden;
      closeMenus();
      if (shouldOpen) {
        dom.mobileAccountMenu.hidden = false;
        dom.mobileAccountButton.setAttribute("aria-expanded", "true");
      }
    });

    dom.signOutButton.addEventListener("click", signOut);
    dom.mobileSignOutButton.addEventListener("click", signOut);

    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element)) return;
      const insideProfile = event.target.closest(".profile-slot");
      const insideMobile = event.target.closest(".mobile-account, .mobile-account-menu");
      if (!insideProfile && !insideMobile) closeMenus();
    });

    dom.feedSearch.addEventListener("input", () => {
      state.query.q = dom.feedSearch.value;
      dom.searchClear.hidden = !dom.feedSearch.value;
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => loadItems(), 260);
    });

    dom.feedSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        window.clearTimeout(state.searchTimer);
        loadItems();
      } else if (event.key === "Escape" && dom.feedSearch.value) {
        event.preventDefault();
        event.stopPropagation();
        dom.feedSearch.value = "";
        state.query.q = "";
        dom.searchClear.hidden = true;
        window.clearTimeout(state.searchTimer);
        loadItems();
      }
    });

    dom.searchClear.addEventListener("click", () => {
      dom.feedSearch.value = "";
      state.query.q = "";
      dom.searchClear.hidden = true;
      updateFilterControls();
      window.clearTimeout(state.searchTimer);
      loadItems();
      dom.feedSearch.focus();
    });

    $$("[data-status-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.query.status = button.dataset.statusFilter || "all";
        updateFilterControls();
        window.clearTimeout(state.searchTimer);
        loadItems();
      });
    });

    dom.locationFilter.addEventListener("change", () => {
      state.query.location = dom.locationFilter.value || "all";
      updateFilterControls();
      window.clearTimeout(state.searchTimer);
      loadItems();
    });

    $$("[data-match-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.matchFilter === "mine" && !state.user) {
          openAuth({ context: "Sign in to see matches involving your reports." });
          return;
        }
        state.matchFilter = button.dataset.matchFilter === "mine" ? "mine" : "all";
        updateMatchControls();
        renderMatches();
      });
    });

    dom.matchSigninButton.addEventListener("click", () => {
      openAuth({ context: "Sign in to contact reporters and see which matches involve your reports." });
    });

    dom.reportForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.composerStage === "review") submitReport();
      else handleComposerSubmit();
    });

    if (dom.composerText) {
      dom.composerText.addEventListener("input", () => {
        autoGrowComposerText();
        updateComposerState();
      });
      dom.composerText.addEventListener("focus", () => {
        state.activeField = "title";
      });
    }
    dom.itemTitle.addEventListener("input", updateComposerState);
    dom.itemTitle.addEventListener("focus", () => {
      state.activeField = "title";
    });
    dom.itemDescription.addEventListener("focus", () => {
      state.activeField = "description";
    });
    dom.itemDescription.addEventListener("input", autoGrowDescription);
    dom.itemLocation.addEventListener("change", () => {
      const isOther = dom.itemLocation.value === "__other__";
      if (dom.customLocationWrap) dom.customLocationWrap.hidden = !isOther;
      if (isOther && dom.customLocation) {
        dom.customLocation.value = "";
        dom.customLocation.focus();
      }
      updateComposerState();
    });
    if (dom.customLocation) {
      dom.customLocation.addEventListener("input", updateComposerState);
    }

    window.addEventListener("resize", autoGrowDescription);
    if (dom.composerText) window.addEventListener("resize", autoGrowComposerText);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(autoGrowDescription).catch(() => {});
      if (dom.composerText) document.fonts.ready.then(autoGrowComposerText).catch(() => {});
    }

    dom.typeLost.addEventListener("click", () => setReportType("lost"));
    dom.typeFound.addEventListener("click", () => setReportType("found"));

    dom.photoButton.addEventListener("click", () => {
      if (!state.photoBusy) dom.photoInput.click();
    });
    dom.photoInput.addEventListener("change", () => {
      const file = dom.photoInput.files && dom.photoInput.files[0];
      if (file) handlePhotoFile(file);
    });
    dom.removePhotoButton.addEventListener("click", removeComposerPhoto);
    dom.dictateButton.addEventListener("click", startDictation);
    dom.dictationStop.addEventListener("click", () => finishDictation());

    dom.authForm.addEventListener("submit", handleAuthSubmit);
    $$("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
    });
    if (dom.passwordToggle) {
      dom.passwordToggle.addEventListener("click", () => {
        const input = dom.authPassword;
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        dom.passwordToggle.textContent = show ? "Hide" : "Show";
      });
    }
    if (dom.forgotLink) {
      dom.forgotLink.addEventListener("click", (event) => {
        event.preventDefault();
        const email = dom.authEmail.value.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) {
          setAuthError("Enter your Flame email first.");
          return;
        }
        api("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) })
          .then(() => showToast({ title: "Reset link sent", message: `Check ${email}.`, tone: "success", duration: 6000 }))
          .catch((error) => showToast({ title: "Couldn't send reset link", message: error.message, tone: "error", duration: 5600 }));
      });
    }
    dom.authClose.addEventListener("click", closeAuthDialog);
    dom.authEmail.addEventListener("input", () => {
      if (!dom.authError.hidden) setAuthError("");
    });
    dom.authDialog.addEventListener("close", () => {
      state.authPending = null;
      authSubmitting = false;
      dom.authSubmit.disabled = false;
      dom.authSubmitLabel.textContent = "Continue";
      setAuthError("");
      syncModalBody();
    });

    dom.contactClose.addEventListener("click", () => closeDialog(dom.contactDialog));
    dom.copyEmailButton.addEventListener("click", copyContactEmail);
    dom.contactDialog.addEventListener("close", () => {
      state.contactItem = null;
      resetCopyButton();
      syncModalBody();
    });

    [dom.authDialog, dom.contactDialog].forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    document.addEventListener("keydown", (event) => {
      const modalOpen = $$("dialog[open]").length > 0;
      const target = event.target;
      const typing = target instanceof Element
        && (target.matches("input, textarea, select") || target.isContentEditable);
      const modifier = event.metaKey || event.ctrlKey;

      if (!modalOpen && modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (state.page !== "feed") goToPage("feed", { focus: false });
        window.requestAnimationFrame(() => dom.feedSearch.focus());
        return;
      }

      if (!modalOpen && !typing && event.key === "/") {
        event.preventDefault();
        if (state.page !== "feed") goToPage("feed", { focus: false });
        window.requestAnimationFrame(() => dom.feedSearch.focus());
        return;
      }

      if (event.key === "Escape") {
        const sidebar = dom.sidebar || document.getElementById("sidebar");
        closeMenus();
        if (sidebar && sidebar.classList.contains("is-open")) closeDrawer();
        if (state.listening) stopDictation();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.listening) stopDictation();
    });

    if (dom.menuToggle) dom.menuToggle.addEventListener("click", toggleDrawer);
    if (dom.menuToggleMobile) dom.menuToggleMobile.addEventListener("click", toggleDrawer);
    if (dom.drawerBackdrop) dom.drawerBackdrop.addEventListener("click", closeDrawer);

    const sidebarToggle = document.getElementById("sidebarToggle");
    if (sidebarToggle) sidebarToggle.addEventListener("click", toggleDrawer);

    const sidebarEl = dom.sidebar || document.getElementById("sidebar");
    if (sidebarEl) {
      sidebarEl.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
          closeDrawer();
        });
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const sidebar = dom.sidebar || document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains("is-open")) closeDrawer();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------

  function updateSearchShortcut() {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform)
      || navigator.platform
      || "";
    if (dom.searchKbd) dom.searchKbd.textContent = /mac|iphone|ipad|ipod/i.test(platform) ? "Cmd K" : "Ctrl K";
  }

  function init() {
    state.user = loadStoredUser();
    if (!state.user) persistUser(null);

    updateProfileUI();
    updateSearchShortcut();
    updateFilterControls();
    setReportType("lost");
    autoGrowDescription();
    updateComposerState();
    bindEvents();
    renderPage(pageFromHash(), { focus: false, scroll: false });
    loadBoard({ initial: true });
    handleAuthCallback();
  }

  function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify");
    const resetToken = params.get("reset");
    const email = params.get("email");
    if (verifyToken && email) {
      api(`/api/auth/verify?token=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(email)}`)
        .then(() => showToast({ title: "Email verified", message: "You can sign in now.", tone: "success", duration: 6000 }))
        .catch((error) => showToast({ title: "Verification failed", message: error.message, tone: "error", duration: 6000 }));
    } else if (resetToken && email) {
      openAuth({ mode: "reset", context: "Set a new password." });
      // store reset token for submit
      state.resetToken = resetToken;
      state.resetEmail = email;
    }
  }

  init();
})();
