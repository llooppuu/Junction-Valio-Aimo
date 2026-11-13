import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header.tsx';
import Footer from './components/Footer.tsx';
import PageHero from './components/ui/PageHero.tsx';
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
          <PageHero title={title} lead="This view is coming next." />
        </main>
        <Footer />
      </div>
    </LangContext.Provider>
  );
}
