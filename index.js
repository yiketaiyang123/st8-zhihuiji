/**
 * st8-zhihuiji —— st-chatu8（智绘姬）体验补丁
 *
 * 功能一：图片左上角 Tag 编辑入口
 *   图片生成完成后，图片左上角出现一个 Tag 图标，点一下打开原插件的
 *   Tag 编辑界面（改提示词 / 看图 / 重新生成 / tag 操作菜单等）。
 *
 * 功能二：生成按钮旁的「图生视频」一键按钮
 *   在每张图的「生成图片 / 生成视频」按钮旁加一个小摄像头按钮，点一下
 *   自动完成「打开编辑界面 → 图像处理 → 图生视频（生成视频提示词）→
 *   直接开始生成视频」，不用再手动点进编辑框点两次。
 *
 * 特点：
 *   完全不修改 st-chatu8 的任何文件。原插件更新后，只要它的图片结构、
 *   “长按打开编辑框”逻辑和编辑界面里的「图生视频」入口还在，补丁就继续生效。
 *
 * 原理：
 *   原插件在每张生成图片上绑定了「长按 1200ms 打开编辑框」的监听，触发时
 *   会检查设置项 longPressToEdit。本补丁：
 *     1) 临时把 longPressToEdit 设为 "true"；
 *     2) 向图片派发一次合成的 mousedown（不冒泡，不触发预览/双击）；
 *     3) 编辑界面（.st-chatu8-edit-backdrop）出现的瞬间把设置原样还原；
 *     4) 图生视频按钮再代为点击编辑界面里的「🎬 图生视频」，等原插件把
 *        视频提示词写回按钮（dataset.video）后，点原版生成按钮开始生成。
 *
 * 作者：yiketaiyang123
 * 仓库：https://github.com/yiketaiyang123/st8-zhihuiji
 */

const PLUGIN_NAME = "st-chatu8";
const PLUGIN_SETTINGS_KEY = "st-chatu8";

const BADGE_CLASS = "st8c-corner-tag";
const BOUND_ATTR = "data-st8c-corner-bound";
const VIDEO_BTN_CLASS = "st8c-video-btn";
const VIDEO_BOUND_ATTR = "data-st8c-video-bound";
const VIDEO_BUSY_ATTR = "data-st8c-busy";
const STYLE_ID = "st8c-corner-style";
const SETTINGS_ROOT_ID = "st8c-settings";
const SETTINGS_CHECKBOX_ID = "st8c-enabled";
const SETTINGS_VIDEO_CHECKBOX_ID = "st8c-video-button";

const LONG_PRESS_TIMEOUT_MS = 5000;       // 兜底：无论成功与否都还原设置并结束长按
const VIDEO_PROMPT_TIMEOUT_MS = 120000;   // 等 LLM 生成视频提示词的上限

const DEFAULTS = {
    enabled: true,
    videoButton: true,
};

const TAG_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/>' +
    '<circle cx="7" cy="7" r="1.4"/>' +
    "</svg>";

const VIDEO_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="2.5" y="7" width="12" height="10" rx="2.2"/>' +
    '<path d="m14.5 10.5 6-3v9l-6-3z"/>' +
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

/* ---- 生成按钮旁的「图生视频」按钮 ---- */
.st8c-video-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--st-chatu8-accent-primary, #4a90d9);
    color: #fff;
    cursor: pointer;
    vertical-align: middle;
    line-height: 1;
    flex: 0 0 auto;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
}
.st8c-video-btn svg {
    width: 15px;
    height: 15px;
    display: block;
    pointer-events: none;
}
.st8c-video-btn:hover {
    transform: translateY(-1px) scale(1.06);
    filter: brightness(1.12);
}
.st8c-video-btn:active {
    transform: translateY(0) scale(0.95);
}
.st8c-video-btn[data-st8c-busy="1"] {
    opacity: 0.85;
    cursor: progress;
}
.st8c-video-btn[data-st8c-busy="1"] svg {
    display: none;
}
.st8c-video-btn[data-st8c-busy="1"]::after {
    content: "";
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.85);
    border-top-color: transparent;
    animation: st8c-spin 0.8s linear infinite;
}
@keyframes st8c-spin {
    to { transform: rotate(360deg); }
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
    if (settings.videoButton === undefined) settings.videoButton = DEFAULTS.videoButton;
    return settings;
}

function getPluginSettings() {
    const { extensionSettings } = getApi();
    return extensionSettings ? extensionSettings[PLUGIN_SETTINGS_KEY] : null;
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
            window.toastr.warning(message, "st-chatu8 体验补丁", { timeOut: 6000 });
        }
    } catch (_) {
        /* ignore */
    }
}

function toast(kind, message, title) {
    try {
        const fn = window.toastr && window.toastr[kind];
        if (typeof fn === "function") fn(message, title || "st-chatu8 体验补丁");
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function topDocument(doc) {
    try {
        const win = doc.defaultView || window;
        return (win.top && win.top.document) || doc;
    } catch (_) {
        return doc;
    }
}

/* ------------------------------------------------------------------ */
/* 借原插件的长按逻辑打开编辑界面                                       */
/* ------------------------------------------------------------------ */

function findBackdrop(doc) {
    try {
        return topDocument(doc).querySelector(".st-chatu8-edit-backdrop");
    } catch (_) {
        return null;
    }
}

function openTagDialog(img) {
    return new Promise((resolve) => {
        const doc = img && img.ownerDocument;
        if (!doc) {
            resolve(false);
            return;
        }
        const win = doc.defaultView || window;
        const pluginSettings = getPluginSettings();
        if (!pluginSettings) {
            warnOnce("no-plugin", "没有找到 st-chatu8 的设置，请先安装并启用智绘姬本体。");
            resolve(false);
            return;
        }
        if (findBackdrop(doc)) {
            toast("info", "请先关闭已经打开的编辑窗口。");
            resolve(false);
            return;
        }
        if (img.getAttribute("data-st8c-pressing") === "1") {
            resolve(false);
            return;
        }
        img.setAttribute("data-st8c-pressing", "1");

        const previous = pluginSettings.longPressToEdit;
        // 原插件用 == "true" 判断，这里按同样的口径判断，避免布尔 true 被误判
        const needFlip = previous !== "true";
        if (needFlip) pluginSettings.longPressToEdit = "true";

        let settled = false;
        let observer = null;

        const restore = () => {
            if (!needFlip) return;
            try {
                if (previous === undefined) delete pluginSettings.longPressToEdit;
                else pluginSettings.longPressToEdit = previous;
            } catch (_) {
                /* ignore */
            }
        };

        const mouse = (type, buttons) => {
            try {
                return new win.MouseEvent(type, {
                    bubbles: false,
                    cancelable: true,
                    view: win,
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

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            restore();
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
            resolve(ok);
        };

        const onMutation = () => {
            if (!findBackdrop(doc)) return;
            pressEnd();
            finish(true);
        };

        try {
            const MO = (win.top && win.top.MutationObserver) || win.MutationObserver;
            const target = topDocument(doc);
            if (MO && target.body) {
                observer = new MO(onMutation);
                observer.observe(target.body, { childList: true, subtree: true });
            }
        } catch (_) {
            /* ignore */
        }

        try {
            img.dispatchEvent(mouse("mousedown", 1));
        } catch (err) {
            console.warn("[st8c] 派发 mousedown 失败:", err);
        }

        win.setTimeout(() => {
            if (settled) return;
            pressEnd();
            finish(false);
            warnOnce("no-dialog", "没能打开 Tag 编辑界面：原插件版本可能已变更（长按逻辑或样式类名改变）。");
        }, LONG_PRESS_TIMEOUT_MS);
    });
}

/* ------------------------------------------------------------------ */
/* 图生视频：自动完成「编辑框 → 图生视频 → 开始生成」                    */
/* ------------------------------------------------------------------ */

/** 临时挂一下 toastr，用来尽早发现原插件图生视频的成功/失败（只是加速，失败也不影响主流程） */
function watchPluginToasts(onEvent) {
    const t = window.toastr;
    if (!t) return () => {};
    const originals = {};
    const wrapped = {};
    ["success", "error"].forEach((name) => {
        const original = t[name];
        if (typeof original !== "function") return;
        originals[name] = original;
        wrapped[name] = function (...args) {
            try {
                onEvent(name, String(args[0] === undefined ? "" : args[0]));
            } catch (_) {
                /* ignore */
            }
            return original.apply(this, args);
        };
        t[name] = wrapped[name];
    });
    return () => {
        ["success", "error"].forEach((name) => {
            if (originals[name] && t[name] === wrapped[name]) t[name] = originals[name];
        });
    };
}

function findImageForPluginButton(button) {
    const doc = button.ownerDocument;
    if (!doc) return null;
    const scoped = button.closest(".mes_text") || doc;
    const requestId = button.dataset ? button.dataset.requestId : "";
    let span = null;
    if (requestId) {
        span = scoped.querySelector(`.st-chatu8-image-span[data-request-id="${cssEscape(requestId)}"]`);
    }
    if (!span) {
        let el = button.nextElementSibling;
        while (el) {
            if (el.classList && el.classList.contains("st-chatu8-image-span")) {
                span = el;
                break;
            }
            if (!(el.classList && el.classList.contains(VIDEO_BTN_CLASS))) break;
            el = el.nextElementSibling;
        }
    }
    if (!span) return null;
    const container = span.querySelector(".st-chatu8-image-container");
    if (!container) return null;
    return Array.from(container.children).find((child) => child.tagName === "IMG") || null;
}

/** 编辑界面里「图生视频」的触发元素：图片模式下在隐藏菜单里，视频模式下是直接按钮 */
function findImg2VideoTrigger(dialog) {
    if (!dialog) return null;
    const menuItem = Array.from(dialog.querySelectorAll(".st-chatu8-image-process-item"))
        .find((el) => (el.textContent || "").includes("图生视频"));
    if (menuItem) return menuItem;
    return Array.from(dialog.querySelectorAll("button"))
        .find((el) => (el.textContent || "").includes("图生视频提示词")) || null;
}

function firePressSequence(el, win) {
    const make = (type, buttons) => {
        try {
            return new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, button: 0, buttons });
        } catch (_) {
            return new Event(type, { bubbles: true, cancelable: true });
        }
    };
    el.dispatchEvent(make("mousedown", 1));
    el.dispatchEvent(make("mouseup", 0));
}

function setVideoButtonBusy(button, busy) {
    if (!button) return;
    if (busy) {
        button.setAttribute(VIDEO_BUSY_ATTR, "1");
        button.title = "正在生成视频提示词…（再点一次可取消自动生成）";
    } else {
        button.removeAttribute(VIDEO_BUSY_ATTR);
        button.title = "图生视频：自动生成视频提示词并直接开始生成视频";
    }
}

async function waitForVideoContent(button, previous, state) {
    const deadline = Date.now() + VIDEO_PROMPT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (state.cancelled) {
            toast("info", "已取消自动生成。视频提示词如果已经生成，会保存在这张图上。");
            return null;
        }
        if (state.error) throw new Error(state.error);
        if (!button.isConnected) {
            toast("warning", "消息已刷新，图生视频已中断。");
            return null;
        }
        const value = button.dataset ? button.dataset.video || "" : "";
        if (value && value !== previous) return value;
        if (state.done && value) return value;
        await sleep(350);
    }
    toast("warning", "等待视频提示词超时，请检查插件 LLM 设置里「图生视频」的配置。");
    return null;
}

async function runImageToVideo(pluginButton, triggerButton) {
    if (!pluginButton || !triggerButton) return;
    if (triggerButton.getAttribute(VIDEO_BUSY_ATTR) === "1") {
        // 忙碌时再点一下 = 取消自动生成
        triggerButton.setAttribute("data-st8c-cancel", "1");
        return;
    }
    const pluginSettings = getPluginSettings();
    if (!pluginSettings) {
        warnOnce("no-plugin", "没有找到 st-chatu8 的设置，请先安装并启用智绘姬本体。");
        return;
    }
    const channel = pluginSettings.videoChannel || "comfyui";
    if (channel === "none") {
        toast("warning", "视频渠道是「无」，请先在插件设置里启用 ComfyUI / RunningHub 视频。");
        return;
    }
    if (pluginButton.hasAttribute("data-loading")) {
        toast("info", "这张图正在生成中，请稍候再试。");
        return;
    }
    const img = findImageForPluginButton(pluginButton);
    if (!img) {
        toast("warning", "没找到对应的图片，无法发起图生视频。");
        return;
    }

    const doc = pluginButton.ownerDocument;
    const win = doc.defaultView || window;
    const state = { cancelled: false, error: null, done: false };
    let unwatchToasts = null;

    triggerButton.removeAttribute("data-st8c-cancel");
    setVideoButtonBusy(triggerButton, true);

    const cancelWatcher = setInterval(() => {
        if (triggerButton.getAttribute("data-st8c-cancel") === "1") {
            state.cancelled = true;
            triggerButton.removeAttribute("data-st8c-cancel");
        }
    }, 200);

    let openedBackdrop = null;
    try {
        const opened = await openTagDialog(img);
        if (!opened) throw new Error("打开编辑界面超时（原插件版本可能已变更）");

        openedBackdrop = findBackdrop(doc);
        const dialog = openedBackdrop && openedBackdrop.querySelector(".st-chatu8-edit-dialog");
        if (!dialog) throw new Error("没有找到编辑界面");

        const trigger = findImg2VideoTrigger(dialog);
        if (!trigger) throw new Error("编辑界面里没有「图生视频」入口（原插件版本可能已变更）");

        const previous = pluginButton.dataset ? pluginButton.dataset.video || "" : "";

        // 先挂上 toast 监听再触发，避免错过原插件很快给出的失败提示
        unwatchToasts = watchPluginToasts((kind, message) => {
            if (!message.includes("图生视频")) return;
            if (kind === "success") state.done = true;
            else if (kind === "error") state.error = message;
        });

        firePressSequence(trigger, win);

        // 编辑框已经用不到了，立刻关掉，别挡住聊天
        try {
            if (openedBackdrop.isConnected) openedBackdrop.remove();
        } catch (_) {
            /* ignore */
        }

        const content = await waitForVideoContent(pluginButton, previous, state);
        if (!content) return;
        if (!pluginButton.isConnected) {
            toast("warning", "消息已刷新，请重新点击。");
            return;
        }
        toast("info", "🎬 视频提示词已就绪，开始生成视频…");
        pluginButton.click();
    } catch (err) {
        console.warn("[st8c]", err);
        toast("error", "图生视频失败：" + (err && err.message ? err.message : String(err)));
    } finally {
        clearInterval(cancelWatcher);
        if (unwatchToasts) unwatchToasts();
        setVideoButtonBusy(triggerButton, false);
        try {
            if (openedBackdrop && openedBackdrop.isConnected && openedBackdrop === findBackdrop(doc)) {
                openedBackdrop.remove();
            }
        } catch (_) {
            /* ignore */
        }
    }
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
/* 给图片容器挂 Tag 角标                                               */
/* ------------------------------------------------------------------ */

function attachBadge(container) {
    if (!container || !container.isConnected) return;
    if (container.getAttribute(BOUND_ATTR) === "1") return;

    const settings = getSettings();
    if (!settings.enabled) return;

    // 只处理「图片」容器：原版把 img 作为容器的直接子节点
    const img = Array.from(container.children).find((child) => child.tagName === "IMG");
    if (!img) return;

    // 原版以后若自带该入口，自动让位，避免两个角标叠在一起
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
        openTagDialog(img);
    };

    badge.addEventListener("click", open);
    badge.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") open(event);
    });

    container.appendChild(badge);
    scheduleRefresh();
}

/* ------------------------------------------------------------------ */
/* 给原版生成按钮挂「图生视频」按钮                                     */
/* ------------------------------------------------------------------ */

function attachVideoButton(pluginButton) {
    if (!pluginButton || !pluginButton.isConnected) return;
    if (!pluginButton.classList || !pluginButton.classList.contains("image-tag-button")) return;
    if (!getSettings().videoButton) return;

    const next = pluginButton.nextElementSibling;
    if (next && next.classList && next.classList.contains(VIDEO_BTN_CLASS)) return;

    const doc = pluginButton.ownerDocument;
    if (!doc) return;
    ensureStyle(doc);

    const button = doc.createElement("button");
    button.type = "button";
    button.className = VIDEO_BTN_CLASS;
    button.setAttribute("aria-label", "图生视频");
    button.title = "图生视频：自动生成视频提示词并直接开始生成视频";
    button.innerHTML = VIDEO_ICON_SVG;

    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("mouseup", (event) => event.stopPropagation());
    button.addEventListener("dblclick", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        runImageToVideo(pluginButton, button);
    });

    pluginButton.setAttribute(VIDEO_BOUND_ATTR, "1");
    pluginButton.insertAdjacentElement("afterend", button);
}

/** 插件重渲染会把原版按钮换掉，这里把因此变成孤儿的按钮清掉 */
function pruneOrphanVideoButtons(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("." + VIDEO_BTN_CLASS).forEach((button) => {
        const prev = button.previousElementSibling;
        const prevIsPluginButton = !!(prev && prev.classList && prev.classList.contains("image-tag-button"));
        if (!prevIsPluginButton) button.remove();
    });
}

/* ------------------------------------------------------------------ */
/* DOM 扫描与监听                                                      */
/* ------------------------------------------------------------------ */

function attachAll(root) {
    if (!root || !root.querySelectorAll) return;
    const settings = getSettings();
    if (settings.enabled) {
        root.querySelectorAll(".st-chatu8-image-container").forEach((container) => attachBadge(container));
    }
    if (settings.videoButton) {
        root.querySelectorAll("button.image-tag-button").forEach((button) => attachVideoButton(button));
    }
    pruneOrphanVideoButtons(root);
}

function attachDeferred(node) {
    if (!node || node.nodeType !== 1) return;
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
        if (node.classList && node.classList.contains(VIDEO_BTN_CLASS)) continue;
        if (node.matches && node.matches("button.image-tag-button")) {
            attachVideoButton(node);
            continue;
        }
        if (node.querySelectorAll) {
            node.querySelectorAll(".st-chatu8-image-container").forEach((container) => attachBadge(container));
            node.querySelectorAll("button.image-tag-button").forEach((button) => attachVideoButton(button));
        }
    }
}

const pruneScheduled = new WeakSet();

function schedulePrune(doc) {
    if (!doc || pruneScheduled.has(doc)) return;
    pruneScheduled.add(doc);
    const win = doc.defaultView || window;
    const raf = win && typeof win.requestAnimationFrame === "function"
        ? win.requestAnimationFrame.bind(win)
        : (fn) => setTimeout(fn, 16);
    raf(() => {
        pruneScheduled.delete(doc);
        pruneOrphanVideoButtons(doc);
    });
}

function watchDocument(doc) {
    if (!doc || !doc.body) return;
    const win = doc.defaultView || window;
    const MO = win && win.MutationObserver;
    if (!MO) return;
    const observer = new MO((records) => {
        let removed = false;
        for (const record of records) {
            if (record.removedNodes && record.removedNodes.length) removed = true;
            if (!record.addedNodes || !record.addedNodes.length) continue;
            for (const node of record.addedNodes) {
                if (!node || node.nodeType !== 1) continue;
                attachDeferred(node);
                if (node.tagName === "IFRAME") watchIframe(node);
                else if (node.querySelectorAll) {
                    node.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
                }
            }
        }
        if (removed) schedulePrune(doc);
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
        attachAll(doc);
        watchDocument(doc);
    };
    iframe.addEventListener("load", run);
    run();
}

function removeAllEnhancements() {
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
            doc.querySelectorAll("." + VIDEO_BTN_CLASS).forEach((button) => button.remove());
            doc.querySelectorAll(`[${BOUND_ATTR}]`).forEach((container) => container.removeAttribute(BOUND_ATTR));
            doc.querySelectorAll(`[${VIDEO_BOUND_ATTR}]`).forEach((button) => button.removeAttribute(VIDEO_BOUND_ATTR));
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
                <b>st-chatu8 体验补丁</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" for="${SETTINGS_CHECKBOX_ID}">
                    <input id="${SETTINGS_CHECKBOX_ID}" type="checkbox" />
                    <span>图片左上角显示 Tag 编辑入口</span>
                </label>
                <label class="checkbox_label" for="${SETTINGS_VIDEO_CHECKBOX_ID}">
                    <input id="${SETTINGS_VIDEO_CHECKBOX_ID}" type="checkbox" />
                    <span>生成按钮旁显示「图生视频」按钮（一步生成视频）</span>
                </label>
                <small class="st8c-hint">
                    本扩展只是补丁，需要先安装并启用 <b>st-chatu8（智绘姬）</b> 本体；
                    它不会修改原插件的任何文件，原版更新后依然可用。
                </small>
            </div>
        </div>
    `;
    host.appendChild(wrapper);

    const badgeCheckbox = wrapper.querySelector("#" + SETTINGS_CHECKBOX_ID);
    if (badgeCheckbox) {
        badgeCheckbox.checked = !!getSettings().enabled;
        badgeCheckbox.addEventListener("change", () => {
            const settings = getSettings();
            settings.enabled = !!badgeCheckbox.checked;
            saveSettings();
            if (settings.enabled) {
                attachAll(document);
                document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
            } else {
                removeAllEnhancements();
                attachAll(document);
            }
        });
    }

    const videoCheckbox = wrapper.querySelector("#" + SETTINGS_VIDEO_CHECKBOX_ID);
    if (videoCheckbox) {
        videoCheckbox.checked = !!getSettings().videoButton;
        videoCheckbox.addEventListener("change", () => {
            const settings = getSettings();
            settings.videoButton = !!videoCheckbox.checked;
            saveSettings();
            if (settings.videoButton) {
                attachAll(document);
                document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
            } else {
                document.querySelectorAll("." + VIDEO_BTN_CLASS).forEach((button) => button.remove());
                document.querySelectorAll(`[${VIDEO_BOUND_ATTR}]`).forEach((button) => button.removeAttribute(VIDEO_BOUND_ATTR));
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
            version: "1.1.0",
            rescan: () => {
                attachAll(document);
                document.querySelectorAll("iframe").forEach((iframe) => watchIframe(iframe));
            },
        };
    } catch (_) {
        /* ignore */
    }

    const boot = () => {
        try {
            getSettings();
        } catch (err) {
            console.warn("[st8c]", err);
        }
        mountSettingsUI();
        attachAll(document);
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
