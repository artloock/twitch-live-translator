(function initPopup(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});
  const $ = (selector) => document.querySelector(selector);

  const elements = {
    enabled: $("#enabled"),
    targetLanguage: $("#targetLanguage"),
    autoDetectLanguage: $("#autoDetectLanguage"),
    ignoreTargetLanguage: $("#ignoreTargetLanguage"),
    ignoreShortMessages: $("#ignoreShortMessages"),
    preserveEmotes: $("#preserveEmotes"),
    translatorApi: $("#translatorApi"),
    languageDetectorApi: $("#languageDetectorApi"),
    prepareModels: $("#prepareModels"),
    modelStatus: $("#modelStatus")
  };

  function fillLanguages() {
    elements.targetLanguage.replaceChildren(
      ...TLT.SUPPORTED_LANGUAGES.map((language) => {
        const option = document.createElement("option");
        option.value = language.code;
        option.textContent = language.label;
        return option;
      })
    );
  }

  function renderSettings(settings) {
    elements.enabled.checked = settings.enabled;
    elements.targetLanguage.value = settings.targetLanguage;
    elements.autoDetectLanguage.checked = settings.autoDetectLanguage;
    elements.ignoreTargetLanguage.checked = settings.ignoreTargetLanguage;
    elements.ignoreShortMessages.checked = settings.ignoreShortMessages;
    elements.preserveEmotes.checked = settings.preserveEmotes;

    const selectedMode = document.querySelector(`input[name="displayMode"][value="${settings.displayMode}"]`);
    if (selectedMode) {
      selectedMode.checked = true;
    }
  }

  function labelForAvailability(value) {
    const labels = {
      available: "Disponivel",
      downloadable: "Disponivel, requer download",
      downloading: "Baixando",
      unavailable: "Nao disponivel",
      needs_activation: "Clique em preparar modelos",
      unknown: "Desconhecido"
    };

    return labels[value] || value || "Desconhecido";
  }

  function renderStatus(status) {
    elements.translatorApi.textContent = labelForAvailability(status && status.translatorApi);
    elements.languageDetectorApi.textContent = labelForAvailability(status && status.languageDetectorApi);

    const modelStatus = status && status.modelStatus;
    if (modelStatus && modelStatus !== "idle") {
      const progress = typeof status.modelProgress === "number"
        ? ` ${Math.round(status.modelProgress * 100)}%`
        : "";
      elements.modelStatus.hidden = false;
      elements.modelStatus.textContent = modelStatus === "downloading_detector"
        ? `Baixando modelo de deteccao...${progress}`
        : `Baixando modelo de traducao...${progress}`;
    } else {
      elements.modelStatus.hidden = true;
      elements.modelStatus.textContent = "";
    }

    elements.prepareModels.disabled = !("Translator" in global) && !("LanguageDetector" in global);
  }

  function updateModelStatus(text) {
    elements.modelStatus.hidden = false;
    elements.modelStatus.textContent = text;
  }

  async function readRuntimeStatus() {
    const values = await TLT.utils.storageGet(chrome.storage.local, {
      [TLT.STATUS_STORAGE_KEY]: {
        translatorApi: "unknown",
        languageDetectorApi: "unknown",
        modelStatus: "idle",
        modelProgress: null
      }
    });

    renderStatus(values[TLT.STATUS_STORAGE_KEY]);
  }

  async function refreshPopupApiStatus() {
    const status = {
      translatorApi: "Translator" in global ? "unknown" : "unavailable",
      languageDetectorApi: "LanguageDetector" in global ? "unknown" : "unavailable",
      modelStatus: "idle",
      modelProgress: null
    };

    if ("Translator" in global) {
      try {
        status.translatorApi = await global.Translator.availability({
          sourceLanguage: "en",
          targetLanguage: elements.targetLanguage.value || TLT.DEFAULT_SETTINGS.targetLanguage
        });
      } catch (error) {
        status.translatorApi = "unavailable";
      }
    }

    if ("LanguageDetector" in global) {
      try {
        status.languageDetectorApi = await global.LanguageDetector.availability();
      } catch (error) {
        status.languageDetectorApi = "unavailable";
      }
    }

    renderStatus(status);
  }

  async function prepareLocalModels() {
    const targetLanguage = elements.targetLanguage.value || TLT.DEFAULT_SETTINGS.targetLanguage;

    elements.prepareModels.disabled = true;
    elements.prepareModels.textContent = "Preparando...";

    const status = {
      translatorApi: "Translator" in global ? "unknown" : "unavailable",
      languageDetectorApi: "LanguageDetector" in global ? "unknown" : "unavailable",
      modelStatus: "idle",
      modelProgress: null,
      lastError: ""
    };

    try {
      if ("LanguageDetector" in global) {
        updateModelStatus("Preparando detector de idioma...");
        const detector = await global.LanguageDetector.create({
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              const progress = Number.isFinite(event.loaded) ? ` ${Math.round(event.loaded * 100)}%` : "";
              updateModelStatus(`Baixando detector de idioma...${progress}`);
            });
          }
        });
        status.languageDetectorApi = "available";
        detector.destroy?.();
      }

      if ("Translator" in global) {
        updateModelStatus("Preparando traducao ingles -> destino...");
        const availability = await global.Translator.availability({
          sourceLanguage: "en",
          targetLanguage
        });

        if (availability === "unavailable") {
          status.translatorApi = "unavailable";
        } else {
          const translator = await global.Translator.create({
            sourceLanguage: "en",
            targetLanguage,
            monitor(monitor) {
              monitor.addEventListener("downloadprogress", (event) => {
                const progress = Number.isFinite(event.loaded) ? ` ${Math.round(event.loaded * 100)}%` : "";
                updateModelStatus(`Baixando modelo de traducao...${progress}`);
              });
            }
          });
          status.translatorApi = "available";
          translator.destroy?.();
        }
      }

      await TLT.utils.storageSet(chrome.storage.local, { [TLT.STATUS_STORAGE_KEY]: status });
      renderStatus(status);
      updateModelStatus("Modelos preparados. Recarregue a aba da Twitch se o chat ja estava aberto.");
    } catch (error) {
      status.lastError = String(error && error.message || error);
      if (/activation|gesture|user/i.test(status.lastError)) {
        status.translatorApi = "needs_activation";
      }
      await TLT.utils.storageSet(chrome.storage.local, { [TLT.STATUS_STORAGE_KEY]: status });
      renderStatus(status);
      updateModelStatus(`Nao foi possivel preparar: ${status.lastError}`);
    } finally {
      elements.prepareModels.disabled = false;
      elements.prepareModels.textContent = "Preparar modelos locais";
    }
  }

  function bindControls() {
    elements.enabled.addEventListener("change", () => TLT.settings.saveSettings({ enabled: elements.enabled.checked }));
    elements.targetLanguage.addEventListener("change", () => {
      TLT.settings.saveSettings({ targetLanguage: elements.targetLanguage.value });
      refreshPopupApiStatus();
    });
    elements.autoDetectLanguage.addEventListener("change", () => TLT.settings.saveSettings({ autoDetectLanguage: elements.autoDetectLanguage.checked }));
    elements.ignoreTargetLanguage.addEventListener("change", () => TLT.settings.saveSettings({ ignoreTargetLanguage: elements.ignoreTargetLanguage.checked }));
    elements.ignoreShortMessages.addEventListener("change", () => TLT.settings.saveSettings({ ignoreShortMessages: elements.ignoreShortMessages.checked }));
    elements.preserveEmotes.addEventListener("change", () => TLT.settings.saveSettings({ preserveEmotes: elements.preserveEmotes.checked }));
    elements.prepareModels.addEventListener("click", prepareLocalModels);

    document.querySelectorAll("input[name='displayMode']").forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          TLT.settings.saveSettings({ displayMode: radio.value });
        }
      });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[TLT.STATUS_STORAGE_KEY]) {
        renderStatus(changes[TLT.STATUS_STORAGE_KEY].newValue);
      }
    });
  }

  async function init() {
    fillLanguages();
    renderSettings(await TLT.settings.getSettings());
    await readRuntimeStatus();
    await refreshPopupApiStatus();
    bindControls();
  }

  init().catch((error) => {
    elements.translatorApi.textContent = "Erro";
    elements.languageDetectorApi.textContent = "Erro";
    TLT.utils.warn("Falha no popup", error);
  });
})(globalThis);
