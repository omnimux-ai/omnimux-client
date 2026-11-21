import type { CaptionTranslator } from "@openreel/core";

export type TranslatorEngineId = "browser";

export type TranslatorAvailability =
  | { engine: TranslatorEngineId; state: "ready"; label: string }
  | { engine: "browser"; state: "downloadable"; label: string }
  | { engine: null; state: "unavailable"; reason: string };

/** The subset of the browser Translator API this feature uses (Chrome 138+). */
export interface BrowserTranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }): Promise<{ translate(text: string, options?: { signal?: AbortSignal }): Promise<string>; destroy?(): void }>;
}

export const browserTranslatorApi = (): BrowserTranslatorApi | undefined => {
  try {
    const api = (globalThis as { Translator?: BrowserTranslatorApi }).Translator;
    return api && typeof api.create === "function" && typeof api.availability === "function" ? api : undefined;
  } catch {
    return undefined;
  }
};

export function languageName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const NO_TRANSLATOR_REASON =
  "On-device translation is unavailable in this browser.";

export async function detectTranslator(
  languages: { sourceLanguage?: string; targetLanguage: string },
  api = browserTranslatorApi(),
): Promise<TranslatorAvailability> {
  if (!api) return { engine: null, state: "unavailable", reason: NO_TRANSLATOR_REASON };
  if (!languages.sourceLanguage) {
    return { engine: null, state: "unavailable", reason: "Enter the language of the source captions to use on-device translation." };
  }
  try {
    const state = await api.availability({ sourceLanguage: languages.sourceLanguage, targetLanguage: languages.targetLanguage });
    if (state === "available") return { engine: "browser", state: "ready", label: "On-device" };
    if (state === "downloadable" || state === "downloading") {
      return { engine: "browser", state: "downloadable", label: "On-device (language pack downloads on first use)" };
    }
  } catch {
    // fall through to unavailable
  }
  return {
    engine: null,
    state: "unavailable",
    reason: "This language pair is unavailable for on-device translation.",
  };
}

export function createBrowserTranslator(
  api: BrowserTranslatorApi,
  onDownloadProgress?: (fraction: number) => void,
): CaptionTranslator {
  return {
    async translate(texts, { sourceLanguage, targetLanguage, signal }) {
      if (!sourceLanguage) throw new Error("Enter the language of the source captions.");
      const translator = await api.create({
        sourceLanguage,
        targetLanguage,
        signal,
        monitor: (m) =>
          m.addEventListener("downloadprogress", (e) => onDownloadProgress?.((e as Event & { loaded?: number }).loaded ?? 0)),
      });
      try {
        const out: string[] = [];
        for (const text of texts) {
          signal?.throwIfAborted();
          out.push(await translator.translate(text, { signal }));
        }
        return out;
      } finally {
        translator.destroy?.();
      }
    },
  };
}

export function makeTranslator(
  onDownloadProgress?: (fraction: number) => void,
): CaptionTranslator {
  const api = browserTranslatorApi();
  if (!api) throw new Error(NO_TRANSLATOR_REASON);
  return createBrowserTranslator(api, onDownloadProgress);
}
