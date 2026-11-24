import { cookies } from "next/headers";

export type Lang = "ar" | "en";
export const LANG_COOKIE = "wh_lang";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === "en" ? "en" : "ar";
}
