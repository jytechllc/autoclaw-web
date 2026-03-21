import { auth0 } from "@/lib/auth0";
import { NextRequest, NextResponse } from "next/server";
import { locales, defaultLocale, isValidLocale } from "@/lib/i18n";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth0 routes - handle directly
  if (pathname.startsWith("/auth/")) {
    return auth0.middleware(request);
  }

  // API routes - run auth0 middleware for session support
  if (pathname.startsWith("/api/")) {
    return auth0.middleware(request);
  }

  // Skip locale redirect for static files, etc.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.startsWith("/robots.txt") ||
    pathname.match(/\.\w+$/)
  ) {
    return NextResponse.next();
  }

  // Check if the pathname already has a valid locale prefix
  const segments = pathname.split("/");
  const firstSegment = segments[1];

  if (isValidLocale(firstSegment)) {
    // Already has locale prefix, continue
    return NextResponse.next();
  }

  // No locale prefix - detect preferred locale and redirect
  const acceptLanguage = request.headers.get("accept-language") || "";
  let detectedLocale = defaultLocale;
  for (const locale of locales) {
    if (acceptLanguage.toLowerCase().includes(locale)) {
      detectedLocale = locale;
      break;
    }
  }

  // Check cookie for previously selected locale
  const cookieLocale = request.cookies.get("locale")?.value;
  if (cookieLocale && isValidLocale(cookieLocale)) {
    detectedLocale = cookieLocale;
  }

  // Redirect to locale-prefixed URL
  const url = request.nextUrl.clone();
  url.pathname = `/${detectedLocale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
