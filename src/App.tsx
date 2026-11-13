import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header.tsx';
import Footer from './components/Footer.tsx';
import PageHero from './components/ui/PageHero.tsx';
import DashboardView from './components/views/DashboardView.tsx';
import WorkspaceView from './components/views/WorkspaceView.tsx';
import { useHashRoute, type Route } from './lib/router.ts';
import { getStrings, LangContext, type Lang, type ShellStrings } from './lib/i18n.ts';
import { DemoStateProvider } from './lib/demo-state.tsx';

function renderView(route: Route, t: ShellStrings) {
  switch (route) {
    case 'dashboard':
      return <DashboardView />;
    case 'workspace':
      return <WorkspaceView />;
    default:
      return (
        <PageHero title={route === 'wholesaler' ? t.wholesalerView : t[route]} lead="This view is coming next." />
      );
  }
}

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

  return (
    <LangContext.Provider value={langValue}>
      <DemoStateProvider>
        <div className="app">
          <Header route={route} />
          <main id="main" className="app-main" tabIndex={-1}>
            {renderView(route, langValue.t)}
          </main>
          <Footer />
        </div>
      </DemoStateProvider>
    </LangContext.Provider>
  );
}
