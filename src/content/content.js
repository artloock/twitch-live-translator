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
    overflowNoticeTimer: null
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
    await publishStatus();
    attachRootObserver();
    locateAndObserveChat();
    TLT.settings.onSettingsChanged(handleSettingsChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    debug("Inicializado", state.settings);
  }

  async function publishStatus() {
    const status = await translationService.refreshStatus(state.settings.targetLanguage);
    safeStorageSet({ [TLT.STATUS_STORAGE_KEY]: status });
  }

  function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || message.type !== "TLT_GET_STATUS") {
      return false;
    }

    sendResponse({
      settings: state.settings,
      status: translationService.getStatus()
    });
    return false;
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

    if (!state.settings.enabled) {
      queue.clear();
      return;
    }

    if (!previous.enabled && state.settings.enabled) {
      processExistingMessages();
    }

    if (requiresRetranslation) {
      TLT.twitchChat.clearTranslations(state.chatContainer);
      await publishStatus();
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
    if (!container || container === state.chatContainer) {
      return;
    }

    if (state.chatObserver) {
      state.chatObserver.disconnect();
    }

    state.chatContainer = container;
    state.chatObserver = new MutationObserver(handleChatMutations);
    state.chatObserver.observe(container, { childList: true, subtree: true });
    debug("Chat encontrado", container);

    if (state.settings.enabled) {
      TLT.twitchChat.cleanDuplicateTranslations(state.chatContainer);
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

    const { body, text } = TLT.twitchChat.extractMessageText(messageElement);
    if (!shouldTranslateMessage(text, state.settings)) {
      return;
    }

    const queued = queue.enqueue(async () => {
      try {
        const sourceLanguage = state.settings.autoDetectLanguage
          ? await translationService.detectLanguage(text)
          : "";
        const targetLanguage = state.settings.targetLanguage;

        if (!sourceLanguage) {
          warn("Idioma nao detectado, mantendo original", text);
          return;
        }

        if (state.settings.ignoreTargetLanguage && sameLanguage(sourceLanguage, targetLanguage)) {
          return;
        }

        const translation = await translationService.translate(text, sourceLanguage, targetLanguage);
        if (!translation || sameLanguage(sourceLanguage, targetLanguage)) {
          return;
        }

        if (!document.contains(messageElement)) {
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
        warn("Erro ao traduzir mensagem", error);
      }
    });

    if (!queued) {
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
