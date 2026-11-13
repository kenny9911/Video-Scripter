// Output languages: what a script, its narration and its publishing package are written in.
//
// The writing rules exist in two families, Chinese and English (`family`): a language writes to the rules
// of its family, and the prompt says which language the result is in. What differs per language is how a
// narration is measured and how fast it is spoken:
//   unit   what a narration is counted in: Chinese, Japanese and Korean by the character, the rest by the word
//          (countSpoken in narration.mjs decides from the id)
//   rate   how many of those are spoken per second, as a multiple of the family's pace (PACE in narration.mjs,
//          or a narration style's own). Japanese at 2.1 is about 5.5 characters a second where English is 2.6
//          words. These are the usual rates of a presenter, rounded; a narration style still scales them.

export const LANGUAGES = [
  { id: 'zh-CN', name: '简体中文', english: 'Simplified Chinese', family: 'zh', rate: 1, unit: '汉字' },
  { id: 'zh-TW', name: '繁體中文', english: 'Traditional Chinese', family: 'zh', rate: 1, unit: '汉字' },
  { id: 'en', name: 'English', english: 'English', family: 'en', rate: 1, unit: 'words' },
  { id: 'ja', name: '日本語', english: 'Japanese', family: 'en', rate: 2.1, unit: 'characters' },
  { id: 'ko', name: '한국어', english: 'Korean', family: 'en', rate: 1.8, unit: 'characters' },
  { id: 'es', name: 'Español', english: 'Spanish', family: 'en', rate: 1.05, unit: 'words' },
  { id: 'fr', name: 'Français', english: 'French', family: 'en', rate: 1.05, unit: 'words' },
  { id: 'de', name: 'Deutsch', english: 'German', family: 'en', rate: 0.85, unit: 'words' },
  { id: 'pt', name: 'Português', english: 'Portuguese', family: 'en', rate: 1, unit: 'words' },
  { id: 'it', name: 'Italiano', english: 'Italian', family: 'en', rate: 0.95, unit: 'words' },
  { id: 'ru', name: 'Русский', english: 'Russian', family: 'en', rate: 0.85, unit: 'words' },
  { id: 'ar', name: 'العربية', english: 'Arabic', family: 'en', rate: 0.8, unit: 'words' },
  { id: 'hi', name: 'हिन्दी', english: 'Hindi', family: 'en', rate: 1, unit: 'words' },
  { id: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', family: 'en', rate: 0.9, unit: 'words' },
  { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', family: 'en', rate: 1.35, unit: 'words' },
  { id: 'tr', name: 'Türkçe', english: 'Turkish', family: 'en', rate: 0.8, unit: 'words' },
  { id: 'nl', name: 'Nederlands', english: 'Dutch', family: 'en', rate: 1, unit: 'words' },
];

const TRADITIONAL = /^zh[-_](tw|hk|mo|hant)/i;

/**
 * The language for an id or a browser tag, or undefined when we do not write in it. "zh" and the two rule
 * families ("zh", "en") are ids of their own, as they were before there was a choice; a regional tag falls
 * back to its language ("pt-BR" is Portuguese, "zh-HK" Traditional Chinese).
 */
export function getLanguage(id) {
  const tag = String(id ?? '').trim();
  if (!tag) return undefined;
  const exact = LANGUAGES.find((l) => l.id.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  if (/^zh(?:[-_]|$)/i.test(tag)) return LANGUAGES.find((l) => l.id === (TRADITIONAL.test(tag) ? 'zh-TW' : 'zh-CN'));
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((l) => l.id === base);
}

/** How a prompt names a language: "Japanese (日本語)", or just "English". */
export const promptName = (language) => (language.english === language.name ? language.english : `${language.english} (${language.name})`);

/** True for the language its family's rules are written in and for: Simplified Chinese, English. */
export const isNative = (language) => language.id === 'zh-CN' || language.id === 'en';

/** What the page needs to offer the choice and to count in it. */
export const publicLanguages = () => LANGUAGES.map(({ id, name, english, family, rate, unit }) => ({ id, name, english, family, rate, unit }));
