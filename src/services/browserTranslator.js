(function initBrowserTranslator(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});
  const {
    debug,
    makeTranslationCacheKey,
    normalizeLanguageCode,
    normalizeWhitespace,
    sameLanguage,
    warn
  } = TLT.utils;

  function classifyApiError(error) {
    const message = String(error && error.message || error || "");
    if (/activation|gesture|user/i.test(message)) {
      return "needs_activation";
    }

    return "unavailable";
  }

  class BrowserTranslatorProvider {
    constructor({ onStatusChange } = {}) {
      this.onStatusChange = onStatusChange || (() => {});
      this.cache = TLT.utils.createLimitedMap(TLT.CACHE_LIMIT);
      this.detectorPromise = null;
      this.translatorPromises = new Map();
      this.status = {
        translatorApi: this.hasTranslatorApi() ? "unknown" : "unavailable",
        languageDetectorApi: this.hasLanguageDetectorApi() ? "unknown" : "unavailable",
        modelStatus: "idle",
        modelProgress: null,
        lastError: ""
      };
    }

    hasTranslatorApi() {
      return "Translator" in global;
    }

    hasLanguageDetectorApi() {
      return "LanguageDetector" in global;
    }

    getStatus() {
      return { ...this.status };
    }

    setStatus(patch) {
      this.status = { ...this.status, ...patch };
      this.onStatusChange(this.getStatus());
    }

    async refreshStatus(targetLanguage = "pt") {
      const normalizedTarget = normalizeLanguageCode(targetLanguage || "pt");

      if (!this.hasTranslatorApi()) {
        this.setStatus({ translatorApi: "unavailable" });
      } else {
        try {
          const availability = await global.Translator.availability({
            sourceLanguage: "en",
            targetLanguage: normalizedTarget
          });
          this.setStatus({ translatorApi: availability || "available" });
        } catch (error) {
          warn("Falha ao verificar Translator API", error);
          this.setStatus({ translatorApi: "unavailable", lastError: String(error && error.message || error) });
        }
      }

      if (!this.hasLanguageDetectorApi()) {
        this.setStatus({ languageDetectorApi: "unavailable" });
      } else {
        try {
          const availability = await global.LanguageDetector.availability();
          this.setStatus({ languageDetectorApi: availability || "available" });
        } catch (error) {
          warn("Falha ao verificar Language Detector API", error);
          this.setStatus({ languageDetectorApi: "unavailable", lastError: String(error && error.message || error) });
        }
      }

      return this.getStatus();
    }

    async getDetector() {
      if (!this.hasLanguageDetectorApi()) {
        return null;
      }

      if (!this.detectorPromise) {
        this.detectorPromise = global.LanguageDetector.create({
          monitor: (monitor) => {
            this.setStatus({ modelStatus: "downloading_detector", modelProgress: null });
            monitor.addEventListener("downloadprogress", (event) => {
              this.setStatus({
                modelStatus: "downloading_detector",
                modelProgress: Number.isFinite(event.loaded) ? event.loaded : null
              });
            });
          }
        })
          .then((detector) => {
            this.setStatus({ languageDetectorApi: "available", modelStatus: "idle", modelProgress: null });
            return detector;
          })
          .catch((error) => {
            this.detectorPromise = null;
            this.setStatus({
              languageDetectorApi: classifyApiError(error),
              modelStatus: "idle",
              modelProgress: null,
              lastError: String(error && error.message || error)
            });
            throw error;
          });
      }

      return this.detectorPromise;
    }

    async detectLanguage(text) {
      const normalized = normalizeWhitespace(text);
      if (!normalized || !this.hasLanguageDetectorApi()) {
        return "";
      }

      try {
        const detector = await this.getDetector();
        if (!detector) {
          return "";
        }

        const results = await detector.detect(normalized);
        const best = Array.isArray(results) ? results[0] : null;
        const language = best && best.confidence >= 0.35 ? best.detectedLanguage : "";
        debug("Idioma detectado", { language, confidence: best && best.confidence, text: normalized });
        return normalizeLanguageCode(language);
      } catch (error) {
        warn("Falha ao detectar idioma", error);
        this.setStatus({ lastError: String(error && error.message || error) });
        return "";
      }
    }

    async getTranslator(sourceLanguage, targetLanguage) {
      if (!this.hasTranslatorApi()) {
        throw new Error("Translator API indisponivel neste navegador.");
      }

      const source = normalizeLanguageCode(sourceLanguage);
      const target = normalizeLanguageCode(targetLanguage);
      const pairKey = `${source}->${target}`;

      if (!source || !target) {
        throw new Error("Par de idiomas invalido.");
      }

      if (!this.translatorPromises.has(pairKey)) {
        const promise = (async () => {
          const availability = await global.Translator.availability({
            sourceLanguage: source,
            targetLanguage: target
          });

          if (availability === "unavailable") {
            throw new Error(`Par de idiomas nao suportado: ${pairKey}`);
          }

          if (availability === "downloadable" || availability === "downloading") {
            this.setStatus({ translatorApi: availability, modelStatus: "downloading_translator", modelProgress: null });
          }

          const translator = await global.Translator.create({
            sourceLanguage: source,
            targetLanguage: target,
            monitor: (monitor) => {
              this.setStatus({ modelStatus: "downloading_translator", modelProgress: null });
              monitor.addEventListener("downloadprogress", (event) => {
                this.setStatus({
                  modelStatus: "downloading_translator",
                  modelProgress: Number.isFinite(event.loaded) ? event.loaded : null
                });
              });
            }
          });

          this.setStatus({ translatorApi: "available", modelStatus: "idle", modelProgress: null });
          return translator;
        })().catch((error) => {
          this.translatorPromises.delete(pairKey);
          this.setStatus({
            translatorApi: classifyApiError(error),
            modelStatus: "idle",
            modelProgress: null,
            lastError: String(error && error.message || error)
          });
          throw error;
        });

        this.translatorPromises.set(pairKey, promise);
      }

      return this.translatorPromises.get(pairKey);
    }

    async translate(text, sourceLanguage, targetLanguage) {
      const normalizedText = normalizeWhitespace(text);
      const source = normalizeLanguageCode(sourceLanguage);
      const target = normalizeLanguageCode(targetLanguage);

      if (!normalizedText || sameLanguage(source, target)) {
        return "";
      }

      const cacheKey = makeTranslationCacheKey(source, target, normalizedText);
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const translator = await this.getTranslator(source, target);
      const translated = normalizeWhitespace(await translator.translate(normalizedText));
      this.cache.set(cacheKey, translated);
      return translated;
    }
  }

  TLT.BrowserTranslatorProvider = BrowserTranslatorProvider;
})(globalThis);
