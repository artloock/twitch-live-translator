(function initTltSettings(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});
  const { debug, warn } = TLT.utils;

  function getArea() {
    return chrome.storage.sync || chrome.storage.local;
  }

  async function getSettings() {
    if (!global.chrome || !chrome.storage) {
      return { ...TLT.DEFAULT_SETTINGS };
    }

    try {
      const values = await TLT.utils.storageGet(getArea(), TLT.DEFAULT_SETTINGS);
      return { ...TLT.DEFAULT_SETTINGS, ...values };
    } catch (error) {
      warn("Falha ao ler configuracoes, usando padrao", error);
      return { ...TLT.DEFAULT_SETTINGS };
    }
  }

  async function saveSettings(partialSettings) {
    const nextSettings = { ...partialSettings };
    await TLT.utils.storageSet(getArea(), nextSettings);
    debug("Configuracoes salvas", nextSettings);
    return nextSettings;
  }

  function onSettingsChanged(callback) {
    if (!global.chrome || !chrome.storage || !chrome.storage.onChanged) {
      return () => {};
    }

    const listener = (changes, areaName) => {
      const syncAvailable = Boolean(chrome.storage.sync);
      const expectedArea = syncAvailable ? "sync" : "local";
      if (areaName !== expectedArea) {
        return;
      }

      const relevantChanges = {};
      for (const [key, change] of Object.entries(changes)) {
        if (Object.prototype.hasOwnProperty.call(TLT.DEFAULT_SETTINGS, key)) {
          relevantChanges[key] = change.newValue;
        }
      }

      if (Object.keys(relevantChanges).length > 0) {
        callback(relevantChanges, changes);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  TLT.settings = {
    getSettings,
    onSettingsChanged,
    saveSettings
  };
})(globalThis);
