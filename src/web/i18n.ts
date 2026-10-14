import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

let language = 'en';
try { language = localStorage.getItem('bithive.language') ?? 'en'; } catch { /* Private browsing can disable storage. */ }
void i18n.use(initReactI18next).init({ resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
  lng: language, supportedLngs: ['en', 'pt-BR'], fallbackLng: 'en', interpolation: { escapeValue: false } });
i18n.on('languageChanged', lng => {
  document.documentElement.lang = lng;
  try { localStorage.setItem('bithive.language', lng); } catch { /* Language still changes for this session. */ }
});
document.documentElement.lang = i18n.language || 'en';
export default i18n;
