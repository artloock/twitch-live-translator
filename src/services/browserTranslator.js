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
      this.detectorNeedsActivation = false;
      this.pairsNeedingActivation = new Set();
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

    needsActivation(targetLanguage) {
      const target = normalizeLanguageCode(targetLanguage);
      return this.detectorNeedsActivation || Array.from(this.pairsNeedingActivation)
        .some((pair) => pair.split("->")[1] === target);
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
            sourceLanguage: sameLanguage("en", normalizedTarget) ? "es" : "en",
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

      if (this.detectorNeedsActivation) {
        throw new Error("User activation required for LanguageDetector.");
      }

      if (!this.detectorPromise) {
        try {
          this.detectorPromise = Promise.resolve(global.LanguageDetector.create({
            monitor: (monitor) => {
              this.setStatus({ modelStatus: "downloading_detector", modelProgress: null });
              monitor.addEventListener("downloadprogress", (event) => {
                this.setStatus({
                  modelStatus: "downloading_detector",
                  modelProgress: Number.isFinite(event.loaded) ? event.loaded : null
                });
              });
            }
          }));
        } catch (error) {
          this.detectorPromise = Promise.reject(error);
        }
        this.detectorPromise = this.detectorPromise
          .then((detector) => {
            this.setStatus({ languageDetectorApi: "available", modelStatus: "idle", modelProgress: null, lastError: "" });
            return detector;
          })
          .catch((error) => {
            this.detectorPromise = null;
            this.detectorNeedsActivation = classifyApiError(error) === "needs_activation";
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

      if (this.pairsNeedingActivation.has(pairKey)) {
        throw new Error(`User activation required for ${pairKey}.`);
      }

      if (!this.translatorPromises.has(pairKey)) {
        const promise = (async () => {
          // Call create before any await to preserve activation from a Twitch event.
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

          this.setStatus({ translatorApi: "available", modelStatus: "idle", modelProgress: null, lastError: "" });
          return translator;
        })().catch((error) => {
          this.translatorPromises.delete(pairKey);
          if (classifyApiError(error) === "needs_activation") {
            this.pairsNeedingActivation.add(pairKey);
          }
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

    prepareModels(targetLanguage, { autoDetectLanguage = true, retryActivation = false } = {}) {
      const target = normalizeLanguageCode(targetLanguage);
      const pairs = new Set([`${sameLanguage("en", target) ? "es" : "en"}->${target}`]);
      if (retryActivation) {
        this.pairsNeedingActivation.forEach((pair) => {
          if (pair.split("->")[1] === target) {
            pairs.add(pair);
            this.pairsNeedingActivation.delete(pair);
          }
        });
        this.detectorNeedsActivation = false;
      }

      // Start both models together, while a trusted event still has activation.
      const tasks = [];
      if (autoDetectLanguage && this.hasLanguageDetectorApi()) {
        tasks.push(this.getDetector());
      }
      if (this.hasTranslatorApi()) {
        pairs.forEach((pair) => tasks.push(this.getTranslator(...pair.split("->"))));
      }
      return Promise.allSettled(tasks).then(() => this.getStatus());
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
