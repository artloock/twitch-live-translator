(function initTwitchLiveTranslator(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});
  const { debug, safeStorageSet, sameLanguage, shouldTranslateMessage, warn } = TLT.utils;

  const state = {
    settings: { ...TLT.DEFAULT_SETTINGS },
    chatContainer: null,
    chatObserver: null,
    rootObserver: null,
    locateScheduled: false,
    overflowNoticeTimer: null,
    generation: 0
  };

  const translationService = TLT.createTranslationService({
    onStatusChange(status) {
      safeStorageSet({ [TLT.STATUS_STORAGE_KEY]: status });
    }
  });

  const queue = new TLT.TranslationQueue({
    maxConcurrent: TLT.MAX_CONCURRENT_TRANSLATIONS,
    maxSize: TLT.MAX_QUEUE_SIZE,
    onOverflow: showOverflowNotice
  });

  async function init() {
    state.settings = await TLT.settings.getSettings();
    safeStorageSet({ [TLT.STATUS_STORAGE_KEY]: translationService.getStatus() });
    attachRootObserver();
    TLT.settings.onSettingsChanged(handleSettingsChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    document.addEventListener("click", handlePageInteraction, true);
    document.addEventListener("keydown", handlePageInteraction, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    locateAndObserveChat();
    debug("Inicializado", state.settings);
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (message && message.type === "TLT_RETRY_MODELS") {
      prepareModels(true).then((status) => sendResponse({ status }));
      return true;
    }
    if (!message || message.type !== "TLT_GET_STATUS") {
      return false;
    }

    sendResponse({
      settings: state.settings,
      status: translationService.getStatus()
    });
    return false;
  }

  function prepareModels(retryActivation = false) {
    if (!state.settings.enabled || !state.chatContainer) {
      return Promise.resolve(translationService.getStatus());
    }
    return translationService.prepareModels(state.settings.targetLanguage, {
      autoDetectLanguage: state.settings.autoDetectLanguage,
      retryActivation
    }).then((status) => {
      processExistingMessages();
      return status;
    });
  }

  function handlePageInteraction(event) {
    if (!event.isTrusted) {
      return;
    }
    if (translationService.needsActivation(state.settings.targetLanguage)) {
      prepareModels(true);
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      locateAndObserveChat();
      prepareModels();
    }
  }

  async function handleSettingsChange(partialSettings) {
    const previous = state.settings;
    state.settings = { ...state.settings, ...partialSettings };
    debug("Configuracoes atualizadas", state.settings);

    if (partialSettings.displayMode) {
      TLT.twitchChat.applyDisplayMode(state.chatContainer, state.settings.displayMode);
    }

    const requiresRetranslation = Boolean(
      partialSettings.targetLanguage ||
      partialSettings.autoDetectLanguage !== undefined ||
      partialSettings.ignoreTargetLanguage !== undefined ||
      partialSettings.ignoreShortMessages !== undefined
    );

    if (requiresRetranslation || partialSettings.enabled !== undefined) {
      state.generation += 1;
      queue.clear();
      TLT.twitchChat.clearTranslations(state.chatContainer);
    }

    if (!state.settings.enabled) {
      return;
    }

    if (!previous.enabled && state.settings.enabled) {
      prepareModels();
      processExistingMessages();
    }

    if (requiresRetranslation) {
      prepareModels();
      processExistingMessages();
    }
  }

  function attachRootObserver() {
    if (state.rootObserver || !document.body) {
      return;
    }

    state.rootObserver = new MutationObserver(() => scheduleLocateChat());
    state.rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleLocateChat() {
    if (state.locateScheduled) {
      return;
    }

    state.locateScheduled = true;
    requestAnimationFrame(() => {
      state.locateScheduled = false;
      locateAndObserveChat();
    });
  }

  function locateAndObserveChat() {
    const container = TLT.twitchChat.findChatContainer(document);
    if (container === state.chatContainer) {
      return;
    }

    if (state.chatObserver) {
      state.chatObserver.disconnect();
    }

    state.generation += 1;
    queue.clear();
    state.chatContainer = container;
    state.chatObserver = null;
    if (!container) {
      return;
    }
    state.chatObserver = new MutationObserver(handleChatMutations);
    state.chatObserver.observe(container, { childList: true, subtree: true });
    debug("Chat encontrado", container);

    if (state.settings.enabled) {
      TLT.twitchChat.cleanDuplicateTranslations(state.chatContainer);
      // A more specific container can replace the fallback while tasks are pending.
      TLT.twitchChat.collectMessageElements(container).forEach((message) => {
        if (message.dataset.tltTranslated !== "true") {
          delete message.dataset.tltProcessed;
        }
      });
      prepareModels();
      processExistingMessages();
    }
  }

  function handleChatMutations(mutations) {
    if (!state.settings.enabled) {
      return;
    }

    const messages = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (TLT.twitchChat.isExtensionNode(node)) {
          continue;
        }

        TLT.twitchChat.collectMessageElements(node).forEach((message) => {
          if (!messages.includes(message)) {
            messages.push(message);
          }
        });
      }
    }

    messages.forEach(processMessage);
  }

  function processExistingMessages() {
    if (!state.chatContainer || !state.settings.enabled) {
      return;
    }

    TLT.twitchChat.collectMessageElements(state.chatContainer).slice(-80).forEach(processMessage);
  }

  function processMessage(messageElement) {
    if (!messageElement || messageElement.dataset.tltProcessed === "true") {
      return;
    }

    messageElement.dataset.tltProcessed = "true";
    const generation = state.generation;
    const settings = { ...state.settings };
    const isCurrent = () => state.settings.enabled && state.generation === generation &&
      document.contains(messageElement);

    const { body, text } = TLT.twitchChat.extractMessageText(messageElement);
    if (!shouldTranslateMessage(text, state.settings)) {
      return;
    }

    const queued = queue.enqueue(async () => {
      if (!isCurrent()) {
        return;
      }
      try {
        const sourceLanguage = settings.autoDetectLanguage
          ? await translationService.detectLanguage(text)
          : "en";
        const targetLanguage = settings.targetLanguage;

        if (!isCurrent()) {
          return;
        }

        if (!sourceLanguage) {
          if (translationService.getStatus().languageDetectorApi !== "available") {
            delete messageElement.dataset.tltProcessed;
          }
          warn("Idioma nao detectado, mantendo original", text);
          return;
        }

        if (settings.ignoreTargetLanguage && sameLanguage(sourceLanguage, targetLanguage)) {
          return;
        }

        const translation = await translationService.translate(text, sourceLanguage, targetLanguage);
        if (!translation || sameLanguage(sourceLanguage, targetLanguage)) {
          return;
        }

        if (!isCurrent()) {
          return;
        }

        TLT.twitchChat.insertTranslation(
          messageElement,
          body,
          translation,
          text,
          state.settings.displayMode
        );
      } catch (error) {
        if (isCurrent()) {
          delete messageElement.dataset.tltProcessed;
        }
        warn("Erro ao traduzir mensagem", error);
      }
    });

    if (!queued) {
      delete messageElement.dataset.tltProcessed;
      warn("Fila cheia, mensagem ignorada");
    }
  }

  function showOverflowNotice() {
    if (!state.chatContainer) {
      return;
    }

    let notice = state.chatContainer.querySelector(":scope > .tlt-status");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "tlt-status";
      notice.setAttribute("data-tlt-extension", "true");
      state.chatContainer.appendChild(notice);
    }

    notice.textContent = "Twitch Live Translator: excedeu o limite da aplicacao. Algumas mensagens nao foram traduzidas.";
    window.clearTimeout(state.overflowNoticeTimer);
    state.overflowNoticeTimer = window.setTimeout(() => notice.remove(), 4500);
  }

  init().catch((error) => warn("Falha ao inicializar extensao", error));
})(globalThis);
