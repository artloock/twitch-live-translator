(function initTltConstants(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});

  TLT.DEBUG = false;

  TLT.DISPLAY_MODES = Object.freeze({
    ORIGINAL_TRANSLATION: "original_translation",
    TRANSLATION_ONLY: "translation_only",
    TRANSLATION_ORIGINAL: "translation_original"
  });

  TLT.DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    targetLanguage: "pt",
    displayMode: "original_translation",
    autoDetectLanguage: true,
    ignoreTargetLanguage: true,
    ignoreShortMessages: true,
    preserveEmotes: true
  });

  TLT.SUPPORTED_LANGUAGES = Object.freeze([
    { code: "pt", label: "Portugues (Brasil)" },
    { code: "en", label: "English" },
    { code: "es", label: "Espanol" },
    { code: "fr", label: "Francais" },
    { code: "de", label: "Deutsch" },
    { code: "it", label: "Italiano" },
    { code: "ja", label: "Japones" },
    { code: "ko", label: "Coreano" },
    { code: "zh", label: "Chines simplificado" },
    { code: "zh-Hant", label: "Chines tradicional" },
    { code: "ru", label: "Russo" },
    { code: "tr", label: "Turco" },
    { code: "uk", label: "Ucraniano" },
    { code: "ar", label: "Arabe" },
    { code: "hi", label: "Hindi" },
    { code: "nl", label: "Holandes" },
    { code: "pl", label: "Polones" },
    { code: "sv", label: "Sueco" }
  ]);

  TLT.TWITCH_SELECTORS = Object.freeze({
    chatContainer: [
      "[data-a-target='chat-scrollable-area__message-container']",
      ".chat-scrollable-area__message-container",
      "[data-test-selector='chat-scrollable-area__message-container']",
      "[role='log']",
      ".chat-list__lines",
      ".stream-chat"
    ],
    message: [
      "[data-a-target='chat-line-message']",
      "[data-test-selector='chat-line-message']",
      ".chat-line__message",
      ".chat-line__message-container",
      "[role='log'] > div"
    ],
    messageBody: [
      "[data-a-target='chat-line-message-body']",
      "[data-a-target='chat-message-text']",
      "[data-test-selector='chat-line-message-body']",
      ".chat-line__message-body",
      ".message"
    ],
    excludeFromText: [
      ".tlt-translation",
      ".tlt-status",
      "[data-tlt-extension='true']",
      "[data-a-target='chat-message-username']",
      "[data-a-target='chat-badge']",
      "[data-a-target='chat-timestamp']",
      "[data-test-selector='chat-badge']",
      ".chat-author__display-name",
      ".chat-line__username",
      ".chat-line__timestamp",
      ".chat-badge",
      "button",
      "svg"
    ]
  });

  TLT.IGNORED_MESSAGE_TOKENS = Object.freeze([
    "F",
    "GG",
    "GGS",
    "WP",
    "L",
    "W",
    "LUL",
    "KEKW",
    "POG",
    "POGGERS",
    "POGCHAMP",
    "OMEGALUL",
    "LOL",
    "LMAO",
    "ROFL"
  ]);

  TLT.CACHE_LIMIT = 750;
  TLT.MAX_CONCURRENT_TRANSLATIONS = 3;
  TLT.MAX_QUEUE_SIZE = 200;
  TLT.STATUS_STORAGE_KEY = "tltRuntimeStatus";
})(globalThis);
