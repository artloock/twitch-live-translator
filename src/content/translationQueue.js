(function initTranslationQueue(global) {
  "use strict";

  const TLT = (global.TLT = global.TLT || {});

  class TranslationQueue {
    constructor({ maxConcurrent, maxSize, onOverflow } = {}) {
      this.maxConcurrent = maxConcurrent || TLT.MAX_CONCURRENT_TRANSLATIONS;
      this.maxSize = maxSize || TLT.MAX_QUEUE_SIZE;
      this.onOverflow = onOverflow || (() => {});
      this.running = 0;
      this.queue = [];
    }

    enqueue(task) {
      if (this.queue.length >= this.maxSize) {
        this.onOverflow();
        return false;
      }

      this.queue.push(task);
      this.drain();
      return true;
    }

    clear() {
      this.queue = [];
    }

    drain() {
      while (this.running < this.maxConcurrent && this.queue.length > 0) {
        const task = this.queue.shift();
        this.running += 1;

        Promise.resolve()
          .then(task)
          .catch((error) => TLT.utils.warn("Falha em tarefa de traducao", error))
          .finally(() => {
            this.running -= 1;
            this.drain();
          });
      }
    }
  }

  TLT.TranslationQueue = TranslationQueue;
})(globalThis);
