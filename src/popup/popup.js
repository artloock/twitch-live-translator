(function initTltPopup(global) {
  "use strict";

  const TLT = global.TLT;
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
  let preparing = false;
  const service = TLT.createTranslationService({ onStatusChange: renderStatus });

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
    for (const key of ["enabled", "autoDetectLanguage", "ignoreTargetLanguage", "ignoreShortMessages", "preserveEmotes"]) {
      elements[key].checked = settings[key];
    }
    elements.targetLanguage.value = settings.targetLanguage;
    const selectedMode = document.querySelector(`input[name="displayMode"][value="${settings.displayMode}"]`);
    if (selectedMode) {
      selectedMode.checked = true;
    }
  }

  function labelForAvailability(value) {
    const labels = {
      available: "Disponivel",
      downloadable: "Requer download",
      downloading: "Baixando",
      unavailable: "Nao disponivel",
      needs_activation: "Aguardando interacao",
      unknown: "Verificando..."
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
      updateModelStatus(modelStatus === "downloading_detector"
        ? `Baixando detector de idioma...${progress}`
        : `Baixando modelo de traducao...${progress}`);
    } else {
      elements.modelStatus.hidden = true;
      elements.modelStatus.textContent = "";
    }
    elements.prepareModels.disabled = preparing || (!("Translator" in global) && !("LanguageDetector" in global));
  }

  function updateModelStatus(text) {
    elements.modelStatus.hidden = false;
    elements.modelStatus.textContent = text;
  }

  async function readActiveTabStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !/^https:\/\/(www\.)?twitch\.tv\//.test(tab.url || "")) {
        return false;
      }
      const response = await chrome.tabs.sendMessage(tab.id, { type: "TLT_GET_STATUS" });
      if (response && response.status) {
        renderStatus(response.status);
        return true;
      }
    } catch (error) {
      TLT.utils.warn("Chat ainda nao disponivel", error);
    }
    return false;
  }

  async function prepareLocalModels() {
    preparing = true;
    elements.prepareModels.disabled = true;
    elements.prepareModels.textContent = "Preparando...";
    try {
      const status = await service.prepareModels(elements.targetLanguage.value, {
        autoDetectLanguage: elements.autoDetectLanguage.checked,
        retryActivation: true
      });
      renderStatus(status);
      const tabs = await chrome.tabs.query({ url: ["https://www.twitch.tv/*", "https://twitch.tv/*"] });
      await Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "TLT_RETRY_MODELS" })));
      if (status.translatorApi === "available" && (!elements.autoDetectLanguage.checked || status.languageDetectorApi === "available")) {
        updateModelStatus("Modelos preparados.");
      } else {
        updateModelStatus(status.lastError || "Modelos indisponiveis neste navegador.");
      }
    } catch (error) {
      updateModelStatus(`Nao foi possivel preparar: ${error.message || error}`);
    } finally {
      preparing = false;
      elements.prepareModels.disabled = !("Translator" in global) && !("LanguageDetector" in global);
      elements.prepareModels.textContent = "Preparar modelos locais";
    }
  }

  function bindControls() {
    for (const key of ["enabled", "autoDetectLanguage", "ignoreTargetLanguage", "ignoreShortMessages", "preserveEmotes"]) {
      elements[key].addEventListener("change", () => {
        TLT.settings.saveSettings({ [key]: elements[key].checked }).catch(TLT.utils.warn);
      });
    }
    elements.targetLanguage.addEventListener("change", async () => {
      try {
        await TLT.settings.saveSettings({ targetLanguage: elements.targetLanguage.value });
        if (!await readActiveTabStatus()) {
          await service.refreshStatus(elements.targetLanguage.value);
        }
      } catch (error) {
        TLT.utils.warn("Falha ao salvar idioma", error);
      }
    });
    elements.prepareModels.addEventListener("click", prepareLocalModels);
    document.querySelectorAll("input[name='displayMode']").forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          TLT.settings.saveSettings({ displayMode: radio.value }).catch(TLT.utils.warn);
        }
      });
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[TLT.STATUS_STORAGE_KEY] && !preparing) {
        readActiveTabStatus();
      }
    });
    TLT.settings.onSettingsChanged(async () => renderSettings(await TLT.settings.getSettings()));
  }

  async function init() {
    fillLanguages();
    renderSettings(await TLT.settings.getSettings());
    bindControls();
    if (!await readActiveTabStatus()) {
      await service.refreshStatus(elements.targetLanguage.value);
    }
  }

  init().catch((error) => {
    elements.translatorApi.textContent = "Erro";
    elements.languageDetectorApi.textContent = "Erro";
    TLT.utils.warn("Falha no popup", error);
  });
})(globalThis);
