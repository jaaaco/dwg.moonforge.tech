export type Locale = 'en' | 'pl'
export const locales: Locale[] = ['en', 'pl']

// One entry per search intent. A page without a counterpart in the other
// language gets `null` and no hreflang pair, instead of a thin translation.
export const routes = {
  home: { en: '/', pl: '/pl' },
  why: { en: '/why', pl: '/pl/dlaczego' },
  guide: { en: '/open-dwg-without-autocad', pl: '/pl/jak-otworzyc-plik-dwg' },
  mac: { en: '/dwg-viewer-mac', pl: null },
  privacy: { en: '/privacy', pl: '/pl/prywatnosc' },
  licenses: { en: '/licenses', pl: '/pl/licencje' }
} as const satisfies Record<string, Record<Locale, string | null>>

export type RouteKey = keyof typeof routes

export function path(key: RouteKey, locale: Locale): string {
  return routes[key][locale] ?? routes[key].en
}

export const REPO_URL = 'https://github.com/jaaaco/dwg.moonforge.tech'
export const MOONFORGE_URL = 'https://moonforge.tech'

export const ui = {
  en: {
    siteName: 'Free DWG Viewer',
    navViewer: 'Viewer',
    navWhy: 'Why',
    navGuide: 'How to open DWG',
    navSource: 'Source code',
    langSwitch: 'Polski',
    footerMadeBy: 'Made by',
    footerLicense: 'Free software under GPL-3.0',
    footerPrivacy: 'Privacy',
    footerLicenses: 'Licenses',
    footerNoTrack: 'No cookies. No upload. No account.',
    footerTrademark: 'Not affiliated with or endorsed by Autodesk. AutoCAD and DWG are trademarks of Autodesk, Inc.',
    skip: 'Skip to viewer',
    // viewer
    vOpen: 'Open DWG or DXF',
    vDrop: 'Drop a drawing here',
    vDropHint: 'The file is read by your browser. It is never uploaded.',
    vSample: 'or try a sample drawing',
    vLayers: 'Layers',
    vAllOn: 'All on',
    vFit: 'Fit',
    vLoadingEngine: 'Loading the DWG engine…',
    vReading: 'Reading drawing…',
    vRendering: 'Drawing…',
    vReady: 'Ready',
    vError: 'Could not open this file',
    vErrorHint: 'Very new or damaged DWG files can fail. Saving it as DXF or an older DWG version usually helps.',
    vTooBig: 'This file is large and may take a while on a phone.',
    vUnsupported: 'Only .dwg and .dxf files can be opened.',
    vClose: 'Close drawing',
    vPrivacyBadge: 'Offline · nothing uploaded'
  },
  pl: {
    siteName: 'Darmowa przeglądarka DWG',
    navViewer: 'Przeglądarka',
    navWhy: 'Dlaczego',
    navGuide: 'Jak otworzyć DWG',
    navSource: 'Kod źródłowy',
    langSwitch: 'English',
    footerMadeBy: 'Zrobione przez',
    footerLicense: 'Wolne oprogramowanie na licencji GPL-3.0',
    footerPrivacy: 'Prywatność',
    footerLicenses: 'Licencje',
    footerNoTrack: 'Bez ciasteczek. Bez wysyłania plików. Bez konta.',
    footerTrademark: 'Serwis nie jest powiązany z Autodesk ani przez niego wspierany. AutoCAD i DWG są znakami towarowymi Autodesk, Inc.',
    skip: 'Przejdź do przeglądarki',
    vOpen: 'Otwórz DWG lub DXF',
    vDrop: 'Upuść rysunek tutaj',
    vDropHint: 'Plik czyta Twoja przeglądarka. Nigdzie go nie wysyłamy.',
    vSample: 'albo otwórz przykładowy rysunek',
    vLayers: 'Warstwy',
    vAllOn: 'Wszystkie',
    vFit: 'Dopasuj',
    vLoadingEngine: 'Ładowanie silnika DWG…',
    vReading: 'Czytanie rysunku…',
    vRendering: 'Rysowanie…',
    vReady: 'Gotowe',
    vError: 'Nie udało się otworzyć pliku',
    vErrorHint: 'Najnowsze lub uszkodzone pliki DWG potrafią się nie otworzyć. Zwykle pomaga zapis jako DXF albo starsza wersja DWG.',
    vTooBig: 'Duży plik, na telefonie może to chwilę potrwać.',
    vUnsupported: 'Otworzysz tylko pliki .dwg i .dxf.',
    vClose: 'Zamknij rysunek',
    vPrivacyBadge: 'Offline · nic nie wysyłamy'
  }
} satisfies Record<Locale, Record<string, string>>

export type UiStrings = (typeof ui)['en']
