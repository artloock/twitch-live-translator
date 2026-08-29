(function initTranslationService(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});

  function createTranslationService(options) {
    const provider = new TLT.BrowserTranslatorProvider(options);

    return {
      detectLanguage(text) {
        return provider.detectLanguage(text);
      },
      translate(text, sourceLanguage, targetLanguage) {
        return provider.translate(text, sourceLanguage, targetLanguage);
      },
      refreshStatus(targetLanguage) {
        return provider.refreshStatus(targetLanguage);
      },
      getStatus() {
        return provider.getStatus();
      }
    };
  }

  TLT.createTranslationService = createTranslationService;
})(globalThis);
