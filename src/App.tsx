import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header.tsx';
import { useHashRoute } from './lib/router.ts';
import { getStrings, LangContext, type Lang } from './lib/i18n.ts';

export default function App() {
  const [route] = useHashRoute();
  const [lang, setLang] = useState<Lang>('en');

  const langValue = useMemo(() => ({ lang, setLang, t: getStrings(lang) }), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Start each view at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  const title = route === 'wholesaler' ? langValue.t.wholesalerView : langValue.t[route];

  return (
    <LangContext.Provider value={langValue}>
      <div className="app">
        <Header route={route} />
        <main id="main" className="app-main" tabIndex={-1}>
          <div className="container" style={{ paddingBlock: 'var(--space-12)' }}>
            <h1>{title}</h1>
          </div>
        </main>
        <footer className="app-footer" aria-label="Site footer" />
      </div>
    </LangContext.Provider>
  );
}
