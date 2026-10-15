// MyNaga entry points (decision D9). MyNaga is the City of Naga's own app; ParaNaga is not
// affiliated with it. These are the four public entry points verified on 15 October 2026
// (ParaNaga_Build_Prompt.md §9E). No deep link, URL scheme or report-prefill contract exists, so
// nothing is ever appended: the URLs are used exactly as written. The Play Store address carries
// its fixed app id (`?id=…`), which is part of the store listing's address, not user data. Pure.

export type MyNagaLinkId = "play" | "appstore" | "website" | "about";

export type MyNagaLink = { id: MyNagaLinkId; label: string; url: string };

export const MYNAGA_VERIFIED_ON = "2026-10-15";

export const MYNAGA_LINKS: readonly MyNagaLink[] = [
  { id: "play", label: "Get MyNaga on Google Play", url: "https://play.google.com/store/apps/details?id=com.easybusph.myNaga" },
  { id: "appstore", label: "Get MyNaga on the App Store", url: "https://apps.apple.com/ph/app/mynaga/id6748720972" },
  { id: "website", label: "Open mynaga.app", url: "https://mynaga.app/" },
  { id: "about", label: "About MyNaga (City of Naga)", url: "https://www2.naga.gov.ph/available-mynaga-app/" },
];

export type Platform = "android" | "ios" | "other";

/** iPadOS reports a desktop Mac user agent; touch points tell it apart. */
export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "other";
}

/** The store matching the platform first; the website and the City's page always follow. */
export function mynagaLinksFor(platform: Platform): MyNagaLink[] {
  const [play, appstore, ...rest] = MYNAGA_LINKS as [MyNagaLink, MyNagaLink, ...MyNagaLink[]];
  return platform === "ios" ? [appstore, play, ...rest] : [play, appstore, ...rest];
}
