
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18n from 'i18next';
import _ from 'lodash';
import App from './App';
import { updateLocalized, localized, sessionLicense, sessionLang } from './state/shared';

const defaultLang = JSON.stringify( require(`./language/en.json`) );
const systemLang = JSON.stringify( require(`./language/system.json`) );
const en = require (`./language/en.json`);
const it = require (`./language/it.json`);

// Map of local language files
const localLangFiles: { [key: string]: any } = {
  en: require('./language/en.json'),
  it: require('./language/it.json')
};

console.log('🌐 index.tsx: sessionLang.value =', sessionLang.value);

// Load Firestore localizations from localStorage (loaded by App.tsx on init)
let firestoreLocalizations: { [key: string]: any } = {};
try {
  const cached = localStorage.getItem('firestoreLocalizations');
  if (cached) {
    firestoreLocalizations = JSON.parse(cached);
    console.log('🌐 Loaded Firestore localizations from cache:', Object.keys(firestoreLocalizations));
  }
} catch (e) {
  console.log('⚠️  Could not load Firestore localizations from cache');
}

// Get available languages: combine local files + Firestore languages (using langKey)
const localLanguageFiles = ['en', 'it'];
// Extract langKey from each Firestore localization, fallback to document ID
const firestoreLanguages = Object.entries(firestoreLocalizations).map(([docId, data]: [string, any]) => data.langKey || docId);
const availableLanguages = [...new Set([...localLanguageFiles, ...firestoreLanguages])];

console.log('🌐 Available languages:', availableLanguages);

// Helper to find Firestore localization by langKey
const findFirestoreLangByKey = (langKey: string) => {
  for (const [docId, data] of Object.entries(firestoreLocalizations)) {
    if ((data as any).langKey === langKey || docId === langKey) {
      return data;
    }
  }
  return {};
};

// Initialize all available language files
availableLanguages.forEach((key) => {
  try {
    // Try to load local language file (may not exist for Firestore-only languages)
    let localizedLang: any = {};
    if (localLangFiles[key]) {
      localizedLang = localLangFiles[key];
      console.log(`🌐 Loaded local file for ${key}`);
    } else {
      // Local file doesn't exist, will use Firestore data only
      console.log(`🌐 No local file for ${key}, using Firestore data only`);
    }

    // Get Firestore localization for this language (by langKey)
    const firestoreLang: any = findFirestoreLangByKey(key);

    // Get license language overrides if available
    let licenseLang = sessionLicense.value?.languages?.[key] || {};

    // Merge order for SAAS:
    // 1. Default English SAAS (base)
    // 2. Local file SAAS (default translations from app)
    // 3. Firestore localization SAAS (customer customizations - overwrites local)
    // 4. License language overrides (highest priority)
    let SAAS = _.merge(
      {},
      JSON.parse(defaultLang).SAAS,
      localizedLang.SAAS || {},  // Local file (default translations)
      firestoreLang.SAAS || firestoreLang.translations || {},  // Firestore overwrites local
      licenseLang
    );

    const joined = JSON.stringify(_.merge({},
      JSON.parse(defaultLang),
      localizedLang,
      {
        key: key,
        lang: key,
        name: SAAS.displayName || firestoreLang.displayName || (key === 'en' ? 'English' : key.toUpperCase()),
        icon: SAAS.iconUrl || firestoreLang.iconUrl || `https://cdn.jsdelivr.net/gh/hampusborgos/country-flags@main/svg/${key}.svg`,
        SAAS: SAAS
      },
      JSON.parse(systemLang))
    );

    const finalTranslation = JSON.parse(joined);

    // Debug: Log the SAAS.HOLD structure to verify deep merge worked
    console.log(`🌐 Language ${key} - SAAS.HOLD structure:`, finalTranslation.SAAS?.HOLD);

    updateLocalized({...localized.value, [key]: {translation: finalTranslation}});

  } catch (error) {
    console.log('lang ' + key + ' is not localized', error)
  }
});

// Initialize i18n with React integration
// Re-read from localStorage after validation (sessionLang.value might have old value)
const initLang = localStorage.getItem('sessionLang') || 'en';
console.log('🌐 Initializing i18n with language:', initLang);
console.log('🌐 Available resources:', Object.keys(localized.value));
console.log('🌐 Italian SAAS.LOT.GUIDE:', localized.value?.it?.translation?.SAAS?.LOT?.GUIDE);

i18n
  .use(initReactI18next) // Enable react-i18next integration for useTranslation hook
  .init({
    interpolation: { escapeValue: false },  // React already does escaping
    lng: initLang,                          // default language from localStorage
    fallbackLng: 'en',                      // fallback to English if translation missing
    resources: localized.value,
    react: {
      useSuspense: false  // Don't use Suspense for translations
    }
  });

console.log('🌐 i18n initialized. Current language:', i18n.language);
console.log('🌐 Test SAAS.LOT.GUIDE:', i18n.t('SAAS.LOT.GUIDE'));

const container: any = document.getElementById('root');

createRoot(container).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>
);
