import { createContext, useContext } from 'react';

export type Lang = 'en' | 'fi';

/** Strings for the app shell (header, navigation and footer). */
const strings = {
  en: {
    skipToContent: 'Skip to content',
    deskTab: 'Purchasing desk',
    wholesalerTab: 'Wholesaler',
    workspaceSwitcher: 'Workspace',
    language: 'Language',
    brand: 'Trusted Trade Agents',
    brandSub: 'Agent purchasing desk',
    mainNav: 'Main navigation',
    dashboard: 'Dashboard',
    workspace: 'Agent workspace',
    catalog: 'Catalog',
    orders: 'Orders',
    activity: 'Activity',
    wholesalerView: 'Wholesaler view',
    signedInAs: 'Signed in as',
    headChef: 'Head chef',
    askAgent: 'Ask the agent',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    footerTagline: 'Purchasing for professional kitchens, done by agents you can trust.',
    footerPurchasing: 'Purchasing',
    footerRecords: 'Records',
    footerWholesaler: 'Wholesaler',
  },
  fi: {
    skipToContent: 'Siirry sisältöön',
    deskTab: 'Ostopiste',
    wholesalerTab: 'Tukkuri',
    workspaceSwitcher: 'Työtila',
    language: 'Kieli',
    brand: 'Trusted Trade Agents',
    brandSub: 'Agenttien ostopiste',
    mainNav: 'Päävalikko',
    dashboard: 'Yleiskatsaus',
    workspace: 'Agentin työtila',
    catalog: 'Valikoima',
    orders: 'Tilaukset',
    activity: 'Tapahtumat',
    wholesalerView: 'Tukkurin näkymä',
    signedInAs: 'Kirjautunut',
    headChef: 'Keittiöpäällikkö',
    askAgent: 'Kysy agentilta',
    openMenu: 'Avaa valikko',
    closeMenu: 'Sulje valikko',
    footerTagline: 'Ammattikeittiöiden hankinnat, luotettavien agenttien hoitamana.',
    footerPurchasing: 'Hankinnat',
    footerRecords: 'Kirjaukset',
    footerWholesaler: 'Tukkuri',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type ShellStrings = { [K in keyof (typeof strings)['en']]: string };

export function getStrings(lang: Lang): ShellStrings {
  return strings[lang];
}

export interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: ShellStrings;
}

export const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => undefined,
  t: strings.en,
});

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
