(function initTltUtils(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});

  function debug(...args) {
    if (TLT.DEBUG) {
      console.debug("[TLT]", ...args);
    }
  }

  function warn(...args) {
    if (TLT.DEBUG) {
      console.warn("[TLT]", ...args);
    }
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeLanguageCode(language) {
    const value = normalizeWhitespace(language).replace("_", "-");
    if (!value) {
      return "";
    }

    const parts = value.split("-");
    if (parts.length === 1) {
      return parts[0].toLowerCase();
    }

    return [
      parts[0].toLowerCase(),
      ...parts.slice(1).map((part) => {
        if (part.length === 4) {
          return part[0].toUpperCase() + part.slice(1).toLowerCase();
        }
        return part.toUpperCase();
      })
    ].join("-");
  }

  function sameLanguage(left, right) {
    const a = normalizeLanguageCode(left);
    const b = normalizeLanguageCode(right);

    if (!a || !b) {
      return false;
    }

    return a === b || a.split("-")[0] === b.split("-")[0];
  }

  function hasUsefulLength(text) {
    const normalized = normalizeWhitespace(text);
    if (normalized.length < 2) {
      return false;
    }

    const lettersOrNumbers = normalized.match(/[\p{L}\p{N}]/gu);
    return Boolean(lettersOrNumbers && lettersOrNumbers.length >= 2);
  }

  function isOnlyUrl(text) {
    return /^https?:\/\/\S+$/i.test(normalizeWhitespace(text));
  }

  function isIgnoredToken(text) {
    const normalized = normalizeWhitespace(text).toUpperCase();
    return TLT.IGNORED_MESSAGE_TOKENS.includes(normalized);
  }

  function looksLikeOnlyEmote(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized || normalized.includes(" ")) {
      return false;
    }

    if (isIgnoredToken(normalized)) {
      return true;
    }

    return /^[A-Za-z][A-Za-z0-9_]{1,24}$/.test(normalized) && !/[aeiou]{2,}/i.test(normalized);
  }

  function shouldTranslateMessage(text, settings) {
    const normalized = normalizeWhitespace(text);

    if (!normalized || isOnlyUrl(normalized) || isIgnoredToken(normalized)) {
      return false;
    }

    if (settings.ignoreShortMessages && !hasUsefulLength(normalized)) {
      return false;
    }

    if (settings.ignoreShortMessages && looksLikeOnlyEmote(normalized)) {
      return false;
    }

    return true;
  }

  function createLimitedMap(limit) {
    const map = new Map();

    return {
      get(key) {
        if (!map.has(key)) {
          return undefined;
        }

        const value = map.get(key);
        map.delete(key);
        map.set(key, value);
        return value;
      },
      set(key, value) {
        if (map.has(key)) {
          map.delete(key);
        }

        map.set(key, value);
        while (map.size > limit) {
          const oldestKey = map.keys().next().value;
          map.delete(oldestKey);
        }
      },
      clear() {
        map.clear();
      },
      get size() {
        return map.size;
      }
    };
  }

  function makeTranslationCacheKey(sourceLanguage, targetLanguage, text) {
    return [
      normalizeLanguageCode(sourceLanguage) || "und",
      normalizeLanguageCode(targetLanguage),
      normalizeWhitespace(text)
    ].join("\u0001");
  }

  function isElement(value) {
    return value && value.nodeType === Node.ELEMENT_NODE;
  }

  function matchesAny(element, selectors) {
    if (!isElement(element)) {
      return false;
    }

    return selectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch (error) {
        warn("Selector invalido ignorado", selector, error);
        return false;
      }
    });
  }

  function findFirst(root, selectors) {
    for (const selector of selectors) {
      try {
        const found = root.querySelector(selector);
        if (found) {
          return found;
        }
      } catch (error) {
        warn("Selector invalido ignorado", selector, error);
      }
    }

    return null;
  }

  function safeStorageSet(data) {
    if (!global.chrome || !chrome.storage || !chrome.storage.local) {
      return;
    }

    storageSet(chrome.storage.local, data).catch((error) => warn("Falha ao gravar status", error));
  }

  function storageGet(area, defaults) {
    return new Promise((resolve, reject) => {
      try {
        area.get(defaults, (result) => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) {
            reject(error);
            return;
          }

          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(area, data) {
    return new Promise((resolve, reject) => {
      try {
        area.set(data, () => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  TLT.utils = {
    createLimitedMap,
    debug,
    findFirst,
    hasUsefulLength,
    isElement,
    makeTranslationCacheKey,
    matchesAny,
    normalizeLanguageCode,
    normalizeWhitespace,
    safeStorageSet,
    sameLanguage,
    shouldTranslateMessage,
    storageGet,
    storageSet,
    warn
  };
})(globalThis);
