"use client";

import { createContext, useContext, type ReactNode } from "react";
import { makeFmt, type Lang } from "./i18n-shared";

const LangContext = createContext<Lang>("ar");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** Client-side formatter/translator: const f = useFmt(); f.t("نص"), f.money(5) */
export function useFmt() {
  return makeFmt(useContext(LangContext));
}
