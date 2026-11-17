/**
 * st8-zhihuiji —— st-chatu8（智绘姬）左上角 Tag 编辑入口 · 补丁扩展
 *
 * 作用：
 *   给 st-chatu8 生成的图片左上角加一个 Tag 图标，点一下即可打开原插件的
 *   Tag 编辑界面（改提示词 / 看图 / 重新生成 / tag 操作菜单等）。
 *
 * 特点：
 *   完全不修改 st-chatu8 的任何文件。原插件更新后，只要它的图片结构与
 *   “长按打开编辑框”逻辑还在，本补丁就继续生效。
 *
 * 原理：
 *   原插件在每张生成图片上绑定了「长按 1200ms 打开编辑框」的监听，触发时
 *   会检查设置项 longPressToEdit。本补丁点击时：
 *     1) 临时把 longPressToEdit 设为 "true"；
 *     2) 向图片派发一次合成的 mousedown（不冒泡，不触发预览/双击）；
 *     3) 编辑界面（.st-chatu8-edit-backdrop）出现的瞬间把设置原样还原。
 *   因此不会写坏用户的设置，也不会影响原插件的其它功能。
 *
 * 作者：yiketaiyang123
 * 仓库：https://github.com/yiketaiyang123/st8-zhihuiji
 */

const PLUGIN_NAME = "st-chatu8";
const PLUGIN_SETTINGS_KEY = "st-chatu8";

const BADGE_CLASS = "st8c-corner-tag";
const BOUND_ATTR = "data-st8c-corner-bound";
const STYLE_ID = "st8c-corner-style";
const SETTINGS_ROOT_ID = "st8c-settings";
const SETTINGS_CHECKBOX_ID = "st8c-enabled";

const LONG_PRESS_TIMEOUT_MS = 5000; // 兜底：无论成功与否都还原设置并结束长按

const DEFAULTS = {
    enabled: true,
};

const TAG_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/>' +
    '<circle cx="7" cy="7" r="1.4"/>' +
    "</svg>";

const BADGE_CSS = `
.st8c-corner-tag {
    position: absolute;
    z-index: 8;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.32);
    background: rgba(18, 18, 28, 0.52);
    color: rgba(255, 255, 255, 0.96);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    cursor: pointer;
    opacity: 0.72;
    line-height: 1;
    transition: opacity 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
}
.st8c-corner-tag::after {
    content: "";
    position: absolute;
    inset: -7px;
    border-radius: 14px;
}
.st8c-corner-tag svg {
    width: 18px;
    height: 18px;
    display: block;
    pointer-events: none;
}
.st-chatu8-image-container:hover .st8c-corner-tag,
.st8c-corner-tag:hover,
.st8c-corner-tag:focus-visible {
    opacity: 1;
}
.st8c-corner-tag:hover {
    transform: scale(1.08);
    background: rgba(74, 144, 226, 0.9);
    border-color: rgba(255, 255, 255, 0.55);
}
.st8c-corner-tag:active {
    transform: scale(0.94);
}
@media (hover: none) {
    .st8c-corner-tag {
        opacity: 0.9;
    }
}
.st-chatu8-image-container:fullscreen .st8c-corner-tag,
.st-chatu8-image-container:-webkit-full-screen .st8c-corner-tag,
.st-chatu8-image-container.st-chatu8-fullscreen-active .st8c-corner-tag,
.st-chatu8-image-container.st-chatu8-landscape-mode .st8c-corner-tag {
    display: none;
}
`;

const EXTENSION_NAME = (() => {
    try {
        const parts = new URL(".", import.meta.url).pathname.split("/").filter(Boolean);
        return parts[parts.length - 1] || "st8-zhihuiji";
    } catch (_) {
        return "st8-zhihuiji";
    }
})();

let apiCache = null;
let installed = false;
const pending = new Set();
let flushScheduled = false;
const watchedIframes = new WeakSet();
const warnedOnce = new Set();

/* ------------------------------------------------------------------ */
/* 基础设施                                                            */
/* ------------------------------------------------------------------ */

function getApi() {
    if (apiCache) return apiCache;
    const ctx = (typeof window !== "undefined" && window.SillyTavern && window.SillyTavern.getContext)
        ? (window.SillyTavern.getContext() || {})
        : {};
    apiCache = {
        extensionSettings: ctx.extensionSettings || {},
        saveSettingsDebounced: ctx.saveSettingsDebounced || (() => {}),
    };
    return apiCache;
}

function getSettings() {
    const { extensionSettings } = getApi();
    let settings = extensionSettings[EXTENSION_NAME];
    if (!settings || typeof settings !== "object") {
        settings = { ...DEFAULTS };
        extensionSettings[EXTENSION_NAME] = settings;
    }
    if (settings.enabled === undefined) settings.enabled = DEFAULTS.enabled;
    return settings;
}

function saveSettings() {
    try {
        getApi().saveSettingsDebounced();
    } catch (err) {
        console.warn("[st8c] 保存设置失败:", err);
    }
}

function warnOnce(key, message) {
    if (warnedOnce.has(key)) return;
    warnedOnce.add(key);
    console.warn("[st8c] " + message);
    try {
        if (window.toastr && typeof window.toastr.warning === "function") {
            window.toastr.warning(message, "st-chatu8 左上角 Tag 补丁", { timeOut: 6000 });
        }
    } catch (_) {
        /* ignore */
    }
}

function ensureStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    try {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = BADGE_CSS;
        (doc.head || doc.documentElement).appendChild(style);
    } catch (err) {
        console.warn("[st8c] 注入样式失败:", err);
    }
}

function cssEscape(value) {
    try {
        if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    } catch (_) {
        /* ignore */
    }
    return String(value).replace(/["\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* 判断这张图片是不是「原插件生成、且带有生成按钮」的图片               */
/* ------------------------------------------------------------------ */

function hasGenerationButton(container) {
    const doc = container.ownerDocument;
    if (!doc) return false;
    try {
        const span = container.closest(".st-chatu8-image-span");
        const requestId = span && span.dataset ? span.dataset.requestId : "";
        if (requestId) {
            return !!doc.querySelector(`button.st-chatu8-image-button[data-request-id="${cssEscape(requestId)}"]`);
        }
        const scope = container.closest(".mes_text") || doc;
        return !!scope.querySelector("button.st-chatu8-image-button");
    } catch (_) {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* 角标定位                                                            */
/* ------------------------------------------------------------------ */

function placeBadge(badge, container, img) {
    try {
        const base = container.getBoundingClientRect();
        const rect = img.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return false;
        const left = Math.round(rect.left - base.left) + 6;
        const top = Math.round(rect.top - base.top) + 6;
        badge.style.left = `${Math.max(0, left)}px`;
        badge.style.top = `${Math.max(0, top)}px`;
        badge.style.visibility = "";
        return true;
    } catch (_) {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* 点击角标：借原插件的长按逻辑打开 Tag 编辑界面                        */
/* ------------------------------------------------------------------ */

function triggerLongPress(img) {
    const doc = img.ownerDocument;
    const win = doc.defaultView || window;
    const { extensionSettings } = getApi();
    const pluginSettings = extensionSettings ? extensionSettings[PLUGIN_SETTINGS_KEY] : null;

    if (!pluginSettings) {
        warnOnce("no-plugin", "没有找到 st-chatu8 的设置，请先安装并启用智绘姬本体。");
        return;
    }
    if (img.getAttribute("data-st8c-pressing") === "1") return;
    img.setAttribute("data-st8c-pressing", "1");

    const previous = pluginSettings.longPressToEdit;
    // 原插件用 == "true" 判断，这里按同样的口径判断，避免布尔 true 被误判
    const needFlip = previous !== "true";
    if (needFlip) pluginSettings.longPressToEdit = "true";

    let restored = false;
    let observer = null;
    let finished = false;

    const restore = () => {
        if (restored) return;
        restored = true;
        if (!needFlip) return;
        try {
            if (previous === undefined) delete pluginSettings.longPressToEdit;
            else pluginSettings.longPressToEdit = previous;
        } catch (_) {
            /* ignore */
        }
    };

    const cleanup = () => {
        if (finished) return;
        finished = true;
        try {
            if (observer) observer.disconnect();
        } catch (_) {
            /* ignore */
        }
        observer = null;
        try {
            img.removeAttribute("data-st8c-pressing");
        } catch (_) {
            /* ignore */
        }
    };

    const topDoc = (() => {
        try {
            return win.top && win.top.document ? win.top.document : doc;
        } catch (_) {
            return doc;
        }
    })();

    const dialogOpened = () => {
        try {
            return !!(topDoc.querySelector(".st-chatu8-edit-backdrop") || doc.querySelector(".st-chatu8-edit-backdrop"));
        } catch (_) {
            return false;
        }
    };

    const mouse = (type, buttons) => {
        try {
            const view = win;
            return new view.MouseEvent(type, {
                bubbles: false,
                cancelable: true,
                view,
                button: 0,
                buttons,
            });
        } catch (_) {
            return new Event(type, { bubbles: false, cancelable: true });
        }
    };

    const pressEnd = () => {
        try {
            img.dispatchEvent(mouse("mouseup", 0));
        } catch (_) {
            /* ignore */
        }
    };

    const onDialog = () => {
        if (!dialogOpened()) return;
        restore(); // 编辑框已打开，立刻把开关还原
        pressEnd(); // 再结束长按，避免一直停留在“按住”状态
        cleanup();
    };

    try {
        const MO = (win.top && win.top.MutationObserver) || win.MutationObserver;
        if (MO && topDoc.body) {
            observer = new MO(onDialog);
            observer.observe(topDoc.body, { childList: true, subtree: true });
        }
    } catch (_) {
        /* ignore */
    }

    try {
        img.dispatchEvent(mouse("mousedown", 1));
    } catch (err) {
        console.warn("[st8c] 派发 mousedown 失败:", err);
    }

    // 不预设原插件的长按阈值：等编辑框出现（onDialog）或超时兜底时再抬起
    win.setTimeout(() => {
        if (restored) return;
        pressEnd();
        restore();
        cleanup();
        if (!dialogOpened()) {
            warnOnce("no-dialog", "没能打开 Tag 编辑界面：原插件版本可能已变更（长按逻辑或样式类名改变）。");
        }
    }, LONG_PRESS_TIMEOUT_MS);
}

/* ------------------------------------------------------------------ */
/* 给容器挂角标                                                        */
/* ------------------------------------------------------------------ */

function attachBadge(container) {
    if (!container || !container.isConnected) return;
    if (container.getAttribute(BOUND_ATTR) === "1") return;

    const settings = getSettings();
    if (!settings.enabled) return;

    // 只处理「图片」容器：原版把 img 作为容器的直接子节点
    const img = Array.from(container.children).find((child) => child.tagName === "IMG");
    if (!img) return;

    // 原版 3.3.0+ 已自带该入口时，自动让位，避免两个角标叠在一起
    if (container.querySelector(".st-chatu8-image-edit-corner") || container.querySelector("." + BADGE_CLASS)) {
        container.setAttribute(BOUND_ATTR, "1");
        return;
    }

    // 没有生成按钮的图片，长按也打不开编辑框，不挂无用的角标
    if (!hasGenerationButton(container)) return;

    const doc = container.ownerDocument;
    if (!doc) return;
    container.setAttribute(BOUND_ATTR, "1");
    ensureStyle(doc);

    if (doc.defaultView) {
        try {
            if (doc.defaultView.getComputedStyle(container).position === "static") {
                container.style.position = "relative";
            }
        } catch (_) {
            container.style.position = "relative";
        }
    }

    const badge = doc.createElement("div");
    badge.className = BADGE_CLASS;
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", "编辑 Tag");
    badge.title = "点击编辑 Tag";
    badge.innerHTML = TAG_ICON_SVG;
    badge.style.visibility = "hidden";

    const view = doc.defaultView || window;
    const refresh = () => {
        if (!badge.isConnected) return;
        placeBadge(badge, container, img);
    };
    const scheduleRefresh = () => {
        const raf = view && typeof view.requestAnimationFrame === "function"
            ? view.requestAnimationFrame.bind(view)
            : (fn) => setTimeout(fn, 16);
        raf(() => {
            refresh();
            setTimeout(refresh, 150);
        });
    };

    img.addEventListener("load", scheduleRefresh);

    let ro = null;
    try {
        const RO = view.ResizeObserver;
        if (typeof RO === "function") {
            ro = new RO(() => {
                if (!badge.isConnected) {
                    if (ro) ro.disconnect();
                    ro = null;
                    return;
                }
                refresh();
            });
            ro.observe(img);
            ro.observe(container);
        }
    } catch (_) {
        /* ignore */
    }

    const stop = (event) => event.stopPropagation();
    ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "touchmove", "dblclick"].forEach((type) => {
        badge.addEventListener(type, stop, { passive: true });
    });
    badge.addEventListener("contextmenu", (event) => event.stopPropagation());

    const open = (event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!getSettings().enabled) {
            badge.remove();
            return;
        }
        if (!img.isConnected) {
            badge.remove();
            return;
        }
        triggerLongPress(img);
    };

    badge.addEventListener("click", open);
    badge.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") open(event);
    });

    container.appendChild(badge);
    scheduleRefresh();
}

function attachBadgeDeferred(node) {
    if (!node || node.nodeType !== 1) return;
    if (!getSettings().enabled) return;
    pending.add(node);
    if (flushScheduled) return;
    flushScheduled = true;
    const view = (node.ownerDocument && node.ownerDocument.defaultView) || window;
    const raf = view && typeof view.requestAnimationFrame === "function"
        ? view.requestAnimationFrame.bind(view)
        : (fn) => setTimeout(fn, 16);
    raf(flushPending);
}

function flushPending() {
    flushScheduled = false;
    const nodes = Array.from(pending);
    pending.clear();
    for (const node of nodes) {
        if (!node.isConnected) continue;
        if (node.classList && node.classList.contains("st-chatu8-image-container")) {
            attachBadge(node);
            continue;
        }
        if (node.querySelectorAll) {
            node.querySelectorAll(".st-chatu8-image-container").forEach((container) => attachBadge(container));
        }
    }
}

function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (!getSettings().enabled) return;
    root.querySelectorAll(".st-chatu8-image-container").forEach((container) => attachBadge(container));
}

/* ------------------------------------------------------------------ */
/* 监听 DOM：新图片出现时自动挂角标（含 iframe 内的消息）               */
/* ------------------------------------------------------------------ */

function watchDocument(doc) {
    if (!doc || !doc.body) return;
    const win = doc.defaultView || window;
    const MO = win && win.MutationObserver;
    if (!MO) return;
    const observer = new MO((records) => {
        for (const record of records) {
            if (!record.addedNodes || !record.addedNodes.length) continue;
            for (const node of record.addedNodes) {
                if (!node || node.nodeType !== 1) continue;
                attachBadgeDeferred(node);
                if (node.tagName === "IFRAME") watchIframe(node);
                else if (node.querySelectorAll) {
                    node.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
                }
            }
        }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    return observer;
}

function watchIframe(iframe) {
    if (!iframe || watchedIframes.has(iframe)) return;
    const run = () => {
        let doc = null;
        try {
            doc = iframe.contentDocument;
        } catch (_) {
            return; // 跨域 iframe，忽略
        }
        if (!doc || !doc.body) return;
        watchedIframes.add(iframe);
        ensureStyle(doc);
        scan(doc);
        watchDocument(doc);
    };
    iframe.addEventListener("load", run);
    run();
}

function removeAllBadges() {
    const docs = [document];
    try {
        document.querySelectorAll("iframe").forEach((iframe) => {
            try {
                if (iframe.contentDocument) docs.push(iframe.contentDocument);
            } catch (_) {
                /* ignore */
            }
        });
    } catch (_) {
        /* ignore */
    }
    for (const doc of docs) {
        try {
            doc.querySelectorAll("." + BADGE_CLASS).forEach((badge) => badge.remove());
            doc.querySelectorAll(`[${BOUND_ATTR}]`).forEach((container) => container.removeAttribute(BOUND_ATTR));
        } catch (_) {
            /* ignore */
        }
    }
}

/* ------------------------------------------------------------------ */
/* 扩展自己的设置面板                                                  */
/* ------------------------------------------------------------------ */

function mountSettingsUI() {
    const host = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
    if (!host) {
        setTimeout(mountSettingsUI, 800);
        return;
    }
    if (document.getElementById(SETTINGS_ROOT_ID)) return;

    const wrapper = document.createElement("div");
    wrapper.id = SETTINGS_ROOT_ID;
    wrapper.className = "st8c-settings";
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>st-chatu8 左上角 Tag 入口（补丁）</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" for="${SETTINGS_CHECKBOX_ID}">
                    <input id="${SETTINGS_CHECKBOX_ID}" type="checkbox" />
                    <span>在生成图片的左上角显示 Tag 编辑入口</span>
                </label>
                <small class="st8c-hint">
                    本扩展只是补丁，需要先安装并启用 <b>st-chatu8（智绘姬）</b> 本体；
                    它不会修改原插件的任何文件，原版更新后依然可用。
                </small>
            </div>
        </div>
    `;
    host.appendChild(wrapper);

    const checkbox = wrapper.querySelector("#" + SETTINGS_CHECKBOX_ID);
    if (checkbox) {
        checkbox.checked = !!getSettings().enabled;
        checkbox.addEventListener("change", () => {
            const settings = getSettings();
            settings.enabled = !!checkbox.checked;
            saveSettings();
            if (settings.enabled) {
                scan(document);
                document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
            } else {
                removeAllBadges();
            }
        });
    }
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function start() {
    if (installed) return;
    installed = true;

    try {
        window.__st8cCornerTagPatch = {
            version: "1.0.0",
            rescan: () => {
                scan(document);
                document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
            },
        };
    } catch (_) {
        /* ignore */
    }

    const boot = () => {
        try {
            getSettings(); // 确保设置对象存在，便于扩展面板读取
        } catch (err) {
            console.warn("[st8c]", err);
        }
        mountSettingsUI();
        scan(document);
        document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
        watchDocument(document);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
}

start();

export { EXTENSION_NAME };
