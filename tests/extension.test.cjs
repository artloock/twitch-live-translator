"use strict";

const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { readFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
let browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.TLT_BROWSER_CHANNEL ? { channel: process.env.TLT_BROWSER_CHANNEL } : {})
  });
});
after(async () => browser?.close());

function mockBrowser({ settings = {}, requiresActivation = false, missingApis = false } = {}) {
  const listeners = [];
  const stored = { sync: { ...settings }, local: {} };
  const fixture = window.fixture = {
    stored, calls: [], readyPairs: new Set(), active: false, detectorReady: false,
    delayTranslations: false, pending: [], errors: []
  };
  const area = (name) => ({
    get(defaults, callback) { callback({ ...defaults, ...stored[name] }); },
    set(values, callback) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: stored[name][key], newValue: value };
        stored[name][key] = value;
      }
      listeners.forEach((listener) => listener(changes, name));
      callback?.();
    }
  });
  Object.defineProperty(window, "chrome", { configurable: true, value: {
    storage: { sync: area("sync"), local: area("local"), onChanged: {
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) { listeners.splice(listeners.indexOf(listener), 1); }
    } },
    runtime: { onMessage: { addListener(listener) { fixture.onMessage = listener; } } },
    tabs: { query: async () => [], sendMessage: async () => ({}) }
  } });
  for (const type of ["click", "keydown"]) {
    window.addEventListener(type, (event) => {
      fixture.active = event.isTrusted;
      setTimeout(() => { fixture.active = false; }, 0);
    }, true);
  }
  if (missingApis) {
    delete window.Translator;
    delete window.LanguageDetector;
    return;
  }
  Object.defineProperty(window, "LanguageDetector", { configurable: true, value: {
    availability: async () => "available",
    create() {
      fixture.calls.push("detector");
      if (requiresActivation && !fixture.detectorReady && !fixture.active) {
        return Promise.reject(new Error("User activation required"));
      }
      fixture.detectorReady = true;
      return Promise.resolve({
        detect: async (text) => [{ detectedLanguage: text.startsWith("Bonjour") ? "fr" : "en", confidence: 0.99 }]
      });
    }
  } });
  Object.defineProperty(window, "Translator", { configurable: true, value: {
    availability: async () => "available",
    create({ sourceLanguage, targetLanguage }) {
      const pair = `${sourceLanguage}->${targetLanguage}`;
      fixture.calls.push(pair);
      if (requiresActivation && !fixture.readyPairs.has(pair) && !fixture.active) {
        return Promise.reject(new Error("User activation required"));
      }
      fixture.readyPairs.add(pair);
      return Promise.resolve({
        translate(text) {
          const result = `[${targetLanguage}] ${text}`;
          if (fixture.delayTranslations) {
            return new Promise((resolve) => fixture.pending.push({ pair, resolve: () => resolve(result) }));
          }
          return Promise.resolve(result);
        }
      });
    }
  } });
}

const message = (text, id = "message") => `<div id="${id}" data-a-target="chat-line-message"><span data-a-target="chat-message-username">Someone</span><span data-a-target="chat-line-message-body">${text}</span></div>`;
const chat = (text = "Hello there", id = "message") => `<div data-a-target="chat-scrollable-area__message-container">${message(text, id)}</div>`;

async function contentPage(options = {}, html = chat()) {
  const page = await browser.newPage();
  page.on("pageerror", (error) => page.evaluate((text) => window.fixture.errors.push(text), error.message));
  await page.setContent(`<button id="player">Player</button>${html}`);
  await page.evaluate(mockBrowser, options);
  for (const script of manifest.content_scripts[0].js) {
    await page.addScriptTag({ path: path.join(root, script) });
  }
  await page.addStyleTag({ path: path.join(root, "src/content/content.css") });
  return page;
}

async function expectTranslation(page, id = "message", language = "pt") {
  await page.waitForFunction(({ id, language }) =>
    document.getElementById(id)?.querySelector(".tlt-translation")?.textContent.includes(`[${language}]`), { id, language });
  assert.equal(await page.locator(`#${id} > .tlt-translation`).count(), 1);
}

test("translates existing and new messages without opening the popup", async () => {
  const page = await contentPage();
  try {
    await expectTranslation(page);
    await page.locator("[data-a-target='chat-scrollable-area__message-container']").evaluate((container, html) => container.insertAdjacentHTML("beforeend", html), message("A new message", "new"));
    await expectTranslation(page, "new");
    assert.equal(await page.locator("[data-a-target='chat-message-username']").first().textContent(), "Someone");
    assert.deepEqual(await page.evaluate(() => fixture.calls), ["detector", "en->pt"]);
  } finally { await page.close(); }
});

test("attaches automatically to a late chat and to the next live", async () => {
  const page = await contentPage({}, "");
  try {
    await page.locator("body").evaluate((body, html) => body.insertAdjacentHTML("beforeend", html), chat());
    await expectTranslation(page);
    await page.locator("[data-a-target='chat-scrollable-area__message-container']").evaluate((container, html) => { container.remove(); document.body.insertAdjacentHTML("beforeend", html); }, chat("Another channel", "next"));
    await expectTranslation(page, "next");
  } finally { await page.close(); }
});

test("resumes blocked models and untranslated messages on a normal Twitch click", async () => {
  const page = await contentPage({ requiresActivation: true });
  try {
    await page.waitForFunction(() => fixture.stored.local.tltRuntimeStatus?.languageDetectorApi === "needs_activation" && fixture.stored.local.tltRuntimeStatus?.translatorApi === "needs_activation");
    assert.equal(await page.locator(".tlt-translation").count(), 0);
    await page.click("#player");
    await expectTranslation(page);
    assert.deepEqual(await page.evaluate(() => fixture.calls), ["detector", "en->pt", "detector", "en->pt"]);
    await page.locator("[data-a-target='chat-scrollable-area__message-container']").evaluate((container, html) => container.insertAdjacentHTML("beforeend", html), message("Bonjour le monde", "french"));
    await page.waitForFunction(() => fixture.stored.local.tltRuntimeStatus.translatorApi === "needs_activation");
    await page.click("#player");
    await expectTranslation(page, "french");
  } finally { await page.close(); }
});

test("pending messages survive replacement of the fallback chat container", async () => {
  const page = await contentPage({}, "");
  try {
    await page.evaluate((html) => {
      fixture.delayTranslations = true;
      document.body.insertAdjacentHTML("beforeend", `<div class="stream-chat">${html}</div>`);
    }, message("Pending fallback message"));
    await page.waitForFunction(() => fixture.pending.length === 1);
    await page.evaluate(() => {
      fixture.delayTranslations = false;
      const container = document.createElement("div");
      container.setAttribute("data-a-target", "chat-scrollable-area__message-container");
      container.appendChild(document.getElementById("message"));
      document.querySelector(".stream-chat").appendChild(container);
    });
    await expectTranslation(page);
    await page.evaluate(() => fixture.pending.forEach((pending) => pending.resolve()));
    assert.equal(await page.locator("#message > .tlt-translation").count(), 1);
  } finally { await page.close(); }
});

test("a ready language pair does not prevent retrying another blocked pair", async () => {
  const page = await contentPage({ requiresActivation: true });
  try {
    await page.waitForFunction(() => fixture.stored.local.tltRuntimeStatus?.languageDetectorApi === "needs_activation");
    await page.click("#player");
    await expectTranslation(page);
    await page.evaluate((html) => {
      fixture.readyPairs.add("fr->es");
      document.querySelector("[data-a-target='chat-scrollable-area__message-container']").insertAdjacentHTML("beforeend", html);
      chrome.storage.sync.set({ targetLanguage: "es" });
    }, message("Bonjour les amis", "french"));
    await expectTranslation(page, "french", "es");
    await page.click("#player");
    await expectTranslation(page, "message", "es");
  } finally { await page.close(); }
});

test("does not retry downloads for every incoming message while activation is blocked", async () => {
  const page = await contentPage({ requiresActivation: true });
  try {
    await page.waitForFunction(() => fixture.stored.local.tltRuntimeStatus?.languageDetectorApi === "needs_activation");
    await page.locator("[data-a-target='chat-scrollable-area__message-container']").evaluate((container, html) => container.insertAdjacentHTML("beforeend", html), message("Still no activation", "new"));
    await page.waitForFunction(() => !document.getElementById("new").dataset.tltProcessed);
    assert.deepEqual(await page.evaluate(() => fixture.calls), ["detector", "en->pt"]);
  } finally { await page.close(); }
});

test("ignores stale translations after a target language change", async () => {
  const page = await contentPage({}, "");
  try {
    await page.evaluate((html) => { fixture.delayTranslations = true; document.body.insertAdjacentHTML("beforeend", html); }, chat());
    await page.waitForFunction(() => fixture.pending.length > 0);
    await page.evaluate(() => { fixture.delayTranslations = false; chrome.storage.sync.set({ targetLanguage: "es" }); });
    await expectTranslation(page, "message", "es");
    await page.evaluate(() => fixture.pending.forEach((pending) => pending.resolve()));
    await page.waitForFunction(() => fixture.stored.local.tltRuntimeStatus.translatorApi === "available");
    assert.match(await page.locator("#message > .tlt-translation").textContent(), /\[es\]/);
  } finally { await page.close(); }
});

test("disabling restores the original and prevents in-flight translations from appearing", async () => {
  const page = await contentPage({ settings: { displayMode: "translation_only" } });
  try {
    await expectTranslation(page);
    assert.equal(await page.locator("#message [data-tlt-original-body]").isVisible(), false);
    await page.evaluate(() => fixture.delayTranslations = true);
    await page.locator("[data-a-target='chat-scrollable-area__message-container']").evaluate((container, html) => container.insertAdjacentHTML("beforeend", html), message("Delayed message", "delayed"));
    await page.waitForFunction(() => fixture.pending.length > 0);
    await page.evaluate(() => { chrome.storage.sync.set({ enabled: false }); fixture.pending.forEach((pending) => pending.resolve()); });
    assert.equal(await page.locator(".tlt-translation").count(), 0);
    assert.equal(await page.locator("#message [data-a-target='chat-line-message-body']").isVisible(), true);
    await page.evaluate(() => { fixture.delayTranslations = false; chrome.storage.sync.set({ enabled: true }); });
    await expectTranslation(page);
    await expectTranslation(page, "delayed");
  } finally { await page.close(); }
});

test("English source mode translates without initializing language detection", async () => {
  const page = await contentPage({ settings: { autoDetectLanguage: false } });
  try {
    await expectTranslation(page);
    assert.deepEqual(await page.evaluate(() => fixture.calls), ["en->pt"]);
  } finally { await page.close(); }
});

test("missing browser APIs leave the original chat intact", async () => {
  const page = await contentPage({ missingApis: true });
  try {
    await page.waitForFunction(() => fixture.onMessage && fixture.stored.local.tltRuntimeStatus?.translatorApi === "unavailable");
    assert.equal(await page.locator(".tlt-translation").count(), 0);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    assert.equal(await page.evaluate(() => fixture.stored.local.tltRuntimeStatus.translatorApi), "unavailable");
  } finally { await page.close(); }
});

test("popup shows only the target language outside the collapsed settings menu", async () => {
  const page = await browser.newPage({ viewport: { width: 330, height: 720 } });
  try {
    await page.addInitScript(mockBrowser);
    await page.goto(pathToFileURL(path.join(root, "src/popup/popup.html")).href);
    await page.waitForFunction(() => document.querySelector("#targetLanguage").value === "pt");
    assert.equal(await page.locator("#targetLanguage").isVisible(), true);
    for (const id of ["enabled", "autoDetectLanguage", "ignoreTargetLanguage", "ignoreShortMessages", "preserveEmotes", "prepareModels", "translatorApi"]) {
      assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    }
    mkdirSync(path.join(root, "test-results"), { recursive: true });
    await page.locator(".popup").screenshot({ path: path.join(root, "test-results/popup-main.png") });
    await page.click("summary");
    assert.equal(await page.locator("#enabled").isVisible(), true);
    await page.selectOption("#targetLanguage", "en");
    await page.waitForFunction(() => fixture.stored.sync.targetLanguage === "en");
    await page.click("#prepareModels");
    await page.waitForFunction(() => document.querySelector("#modelStatus").textContent === "Modelos preparados.");
    assert.ok(await page.evaluate(() => fixture.calls.includes("es->en")));
    await page.locator(".popup").screenshot({ path: path.join(root, "test-results/popup-settings.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const width of [300, 400]) {
      await page.setViewportSize({ width, height: 720 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewportSize({ width: 330, height: 720 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.locator(".popup").screenshot({ path: path.join(root, "test-results/popup-settings-dark.png") });
    await page.click("summary");
    await page.locator(".popup").screenshot({ path: path.join(root, "test-results/popup-main-dark.png") });
  } finally { await page.close(); }
});
