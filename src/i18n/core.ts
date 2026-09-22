import { zhCN, type MessageKey } from './messages.ts';

export type Locale = 'en' | 'zh-CN';
export type LanguagePreference = Locale | 'system';
export type MessageParams = Record<string, string | number>;

export function resolveLocale(preference: LanguagePreference, systemLanguage: string): Locale {
  if (preference !== 'system') return preference;
  return systemLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function translateMessage(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const message = locale === 'zh-CN' ? zhCN[key] : key;
  // Double braces belong to API environment variables and must stay literal.
  return message.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
