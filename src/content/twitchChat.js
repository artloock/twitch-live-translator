(function initTwitchChat(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});
  const { findFirst, isElement, matchesAny, normalizeWhitespace } = TLT.utils;

  function findChatContainer(root = document) {
    return findFirst(root, TLT.TWITCH_SELECTORS.chatContainer);
  }

  function isExtensionNode(node) {
    return isElement(node) && Boolean(node.closest("[data-tlt-extension='true'], .tlt-translation, .tlt-status"));
  }

  function isChatMessage(element) {
    return matchesAny(element, TLT.TWITCH_SELECTORS.message);
  }

  function findExplicitMessageBody(messageElement) {
    for (const selector of TLT.TWITCH_SELECTORS.messageBody) {
      try {
        const found = messageElement.querySelector(selector);
        if (found && !isExtensionNode(found)) {
          return found;
        }
      } catch (error) {
        TLT.utils.warn("Selector de corpo invalido", selector, error);
      }
    }

    return null;
  }

  function hasMessageBody(element) {
    return Boolean(findExplicitMessageBody(element));
  }

  function isNestedInsideCandidate(candidate, allCandidates) {
    return allCandidates.some((other) => other !== candidate && other.contains(candidate));
  }

  function containsNestedCandidate(candidate, allCandidates) {
    return allCandidates.some((other) => other !== candidate && candidate.contains(other));
  }

  function prioritizeMessageCandidates(candidates) {
    const exactCandidates = candidates.filter((candidate) =>
      candidate.matches("[data-a-target='chat-line-message'], [data-test-selector='chat-line-message']")
    );

    if (exactCandidates.length > 0) {
      return exactCandidates.filter((candidate) => !containsNestedCandidate(candidate, exactCandidates));
    }

    const withBody = candidates.filter(hasMessageBody);
    const pool = withBody.length ? withBody : candidates;

    return pool.filter((candidate) => {
      if (containsNestedCandidate(candidate, pool)) {
        return false;
      }

      return !isNestedInsideCandidate(candidate, pool) || candidate.matches(".chat-line__message");
    });
  }

  function collectMessageElements(node) {
    if (!isElement(node) || isExtensionNode(node)) {
      return [];
    }

    const candidates = [];
    if (isChatMessage(node)) {
      candidates.push(node);
    }

    for (const selector of TLT.TWITCH_SELECTORS.message) {
      try {
        node.querySelectorAll(selector).forEach((message) => {
          if (!candidates.includes(message) && !isExtensionNode(message)) {
            candidates.push(message);
          }
        });
      } catch (error) {
        TLT.utils.warn("Selector de mensagem invalido", selector, error);
      }
    }

    return prioritizeMessageCandidates(candidates);
  }

  function findMessageBody(messageElement) {
    return findExplicitMessageBody(messageElement) || messageElement;
  }

  function cloneForText(source) {
    const clone = source.cloneNode(true);

    TLT.TWITCH_SELECTORS.excludeFromText.forEach((selector) => {
      try {
        clone.querySelectorAll(selector).forEach((node) => node.remove());
      } catch (error) {
        TLT.utils.warn("Selector de exclusao invalido", selector, error);
      }
    });

    clone.querySelectorAll("img[alt]").forEach((img) => {
      const replacement = document.createTextNode(` ${img.getAttribute("alt") || ""} `);
      img.replaceWith(replacement);
    });

    clone.querySelectorAll("a").forEach((link) => {
      if (!link.textContent.trim() && link.href) {
        link.textContent = link.href;
      }
    });

    return clone;
  }

  function extractMessageText(messageElement) {
    const body = findMessageBody(messageElement);
    const clone = cloneForText(body);
    const text = normalizeWhitespace(clone.textContent);

    return { body, text };
  }

  function markOriginalBody(body) {
    if (body && body.setAttribute) {
      body.setAttribute("data-tlt-original-body", "true");
    }
  }

  function getTranslationElement(messageElement) {
    return messageElement.querySelector(":scope > .tlt-translation");
  }

  function removeNestedTranslations(messageElement) {
    messageElement.querySelectorAll(".tlt-translation").forEach((translationElement) => {
      if (translationElement.parentElement !== messageElement) {
        translationElement.remove();
      }
    });
  }

  function removeExtraDirectTranslations(messageElement) {
    const translations = Array.from(messageElement.querySelectorAll(":scope > .tlt-translation"));
    translations.slice(1).forEach((translationElement) => translationElement.remove());
  }

  function setOriginalVisibility(messageElement, visible) {
    messageElement.classList.toggle("tlt-hide-original", !visible);
  }

  function insertTranslation(messageElement, body, translation, originalText, displayMode) {
    removeNestedTranslations(messageElement);
    removeExtraDirectTranslations(messageElement);
    markOriginalBody(body);
    messageElement.dataset.tltTranslated = "true";
    messageElement.dataset.tltOriginalText = originalText;
    messageElement.dataset.tltTranslationText = translation;

    let translationElement = getTranslationElement(messageElement);
    if (!translationElement) {
      translationElement = document.createElement("div");
      translationElement.className = "tlt-translation";
      translationElement.setAttribute("data-tlt-extension", "true");
      if (body && body.parentElement === messageElement && body.nextSibling) {
        messageElement.insertBefore(translationElement, body.nextSibling);
      } else {
        messageElement.appendChild(translationElement);
      }
    }

    applyDisplayModeToMessage(messageElement, displayMode);
  }

  function applyDisplayModeToMessage(messageElement, displayMode) {
    const translationElement = getTranslationElement(messageElement);
    if (!translationElement) {
      return;
    }

    const translation = messageElement.dataset.tltTranslationText || "";
    const original = messageElement.dataset.tltOriginalText || "";

    messageElement.classList.remove(
      "tlt-mode-original-translation",
      "tlt-mode-translation-only",
      "tlt-mode-translation-original"
    );

    if (displayMode === TLT.DISPLAY_MODES.TRANSLATION_ONLY) {
      setOriginalVisibility(messageElement, false);
      messageElement.classList.add("tlt-mode-translation-only");
      translationElement.textContent = translation;
      return;
    }

    if (displayMode === TLT.DISPLAY_MODES.TRANSLATION_ORIGINAL) {
      setOriginalVisibility(messageElement, false);
      messageElement.classList.add("tlt-mode-translation-original");
      translationElement.textContent = `${translation} (${original})`;
      return;
    }

    setOriginalVisibility(messageElement, true);
    messageElement.classList.add("tlt-mode-original-translation");
    translationElement.textContent = `\u21B3 ${translation}`;
  }

  function applyDisplayMode(container, displayMode) {
    if (!container) {
      return;
    }

    container.querySelectorAll("[data-tlt-translated='true']").forEach((messageElement) => {
      applyDisplayModeToMessage(messageElement, displayMode);
    });
  }

  function clearTranslations(container) {
    if (!container) {
      return;
    }

    container.querySelectorAll("[data-tlt-processed='true']").forEach((messageElement) => {
      messageElement.removeAttribute("data-tlt-processed");
      messageElement.removeAttribute("data-tlt-translated");
      messageElement.removeAttribute("data-tlt-original-text");
      messageElement.removeAttribute("data-tlt-translation-text");
      messageElement.classList.remove(
        "tlt-hide-original",
        "tlt-mode-original-translation",
        "tlt-mode-translation-only",
        "tlt-mode-translation-original"
      );
    });

    container.querySelectorAll("[data-tlt-original-body='true']").forEach((body) => {
      body.removeAttribute("data-tlt-original-body");
    });

    container.querySelectorAll(".tlt-translation").forEach((node) => node.remove());
  }

  function cleanDuplicateTranslations(container) {
    if (!container) {
      return;
    }

    container.querySelectorAll("[data-tlt-translated='true']").forEach((messageElement) => {
      removeNestedTranslations(messageElement);
      removeExtraDirectTranslations(messageElement);
      applyDisplayModeToMessage(messageElement, messageElement.classList.contains("tlt-mode-translation-only")
        ? TLT.DISPLAY_MODES.TRANSLATION_ONLY
        : messageElement.classList.contains("tlt-mode-translation-original")
          ? TLT.DISPLAY_MODES.TRANSLATION_ORIGINAL
          : TLT.DISPLAY_MODES.ORIGINAL_TRANSLATION);
    });
  }

  TLT.twitchChat = {
    applyDisplayMode,
    cleanDuplicateTranslations,
    clearTranslations,
    collectMessageElements,
    extractMessageText,
    findChatContainer,
    insertTranslation,
    isExtensionNode
  };
})(globalThis);
