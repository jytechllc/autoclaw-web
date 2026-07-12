import Link from "next/link";
import { getDictionary, isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";

export const metadata = {
  title: "Privacy Policy – AutoClaw",
};

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const t = dict.privacy;
  const legalEntity = "JY Tech LLC";

  const sections = [
    { title: t.collectTitle, content: t.collectContent },
    { title: t.useTitle, content: t.useContent },
    { title: t.storageTitle, content: t.storageContent },
    { title: t.sharingTitle, content: t.sharingContent },
    { title: t.cookiesTitle, content: t.cookiesContent },
    { title: t.rightsTitle, content: t.rightsContent },
    { title: t.retentionTitle, content: t.retentionContent },
    { title: t.changesTitle, content: t.changesContent },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl font-bold">
            <span className="text-red-500">Auto</span>Claw
          </Link>
          <Link
            href={`/${locale}`}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            &larr; {t.backHome}
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-2">{t.title}</h1>
        <p className="text-gray-500 text-sm mb-8">{t.lastUpdated}: 2026-03-07</p>

        <p className="text-gray-700 mb-3 leading-relaxed">{t.intro}</p>
        <p className="text-sm text-gray-500 mb-8">AutoClaw is a product and service operated by {legalEntity}.</p>

        <div className="space-y-8">
          {sections.map((section, i) => (
            <section key={i}>
              <h2 className="text-xl font-semibold mb-3">
                {i + 1}. {section.title}
              </h2>
              <p className="text-gray-700 leading-relaxed whitespace-pre-line">{section.content}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <h2 className="text-xl font-semibold mb-3">{t.contactTitle}</h2>
          <p className="text-gray-700 leading-relaxed mb-2">Data controller / service operator: {legalEntity}</p>
          <p className="text-gray-700 leading-relaxed">
            {t.contactContent}{" "}
            <a href="mailto:leo.liu@jytech.us" className="text-red-600 hover:underline">
              Yanlei Liu (leo.liu@jytech.us)
            </a>
          </p>
        </div>
      </main>

      <footer className="bg-slate-900 text-gray-400 border-t border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-xs">
          <p>&copy; {new Date().getFullYear()} {legalEntity}. AutoClaw is a JY Tech LLC product. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
