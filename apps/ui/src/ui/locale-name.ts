/** A locale's name in its own language ("हिन्दी" for `hi`, "Deutsch" for `de`) for the locale
 * switcher, falling back to the code itself where `Intl.DisplayNames` can't name it. */
export function localeDisplayName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale)
    if (name && name !== locale) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    // Invalid tag or no Intl.DisplayNames (very old browsers): show the code.
  }
  return locale
}

/** Labels a switcher option with the locale's native name and marks its language, so screen
 * readers pronounce "தமிழ்" as Tamil. */
export function labelLocaleOption(button: HTMLButtonElement, locale: string): void {
  button.textContent = localeDisplayName(locale)
  button.setAttribute('lang', locale)
  button.setAttribute('data-locale', locale)
}
