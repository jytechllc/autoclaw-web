import Link from "next/link";
import { getDictionary, isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export const metadata = {
  title: "Download – AutoClaw",
};

// Desktop release assets. When a new desktop build is published, bump the
// version + tag here (the Build Windows Desktop workflow tags desktop-v<version>).
// NOTE: points at the Americium3 fork for now; switch to jytechllc/autoclaw-web
// once the desktop branch is merged into the main repo.
const RELEASES_URL = "https://github.com/Americium3/autoclaw-web/releases";
const DESKTOP = {
  version: "0.1.0",
  tag: "desktop-v0.1.0",
  portable: `${RELEASES_URL}/download/desktop-v0.1.0/AutoClaw-0.1.0-Portable.exe`,
  setup: `${RELEASES_URL}/download/desktop-v0.1.0/AutoClaw-0.1.0-Setup.exe`,
};

interface DownloadCopy {
  title: string;
  subtitle: string;
  backHome: string;
  windows: string;
  portableLabel: string;
  portableDesc: string;
  setupLabel: string;
  setupDesc: string;
  download: string;
  recommended: string;
  versionLabel: string;
  smartscreen: string;
  allReleases: string;
}

const copy: Record<string, DownloadCopy> = {
  en: {
    title: "Download AutoClaw Desktop",
    subtitle:
      "A native desktop app for Windows. Same AutoClaw, in its own window — with system tray, native notifications, and an optional portable mode you can carry on a USB drive.",
    backHome: "Back to Home",
    windows: "Windows",
    portableLabel: "Portable (USB) edition",
    portableDesc:
      "No install — double-click to run. Your login and cache live in an AutoClaw-Data folder next to the .exe, so copy it to a USB drive to use it on any machine without re-logging in or leaving traces on the host. 32-bit, runs on any 32/64-bit Windows.",
    setupLabel: "Installer edition",
    setupDesc: "Installs to your PC (writes to %APPDATA%). Adds Start menu and desktop shortcuts.",
    download: "Download",
    recommended: "Recommended",
    versionLabel: "Version",
    smartscreen:
      "Not code-signed yet — if SmartScreen blocks the first run, click “More info → Run anyway”.",
    allReleases: "All versions & release notes",
  },
  zh: {
    title: "下载 AutoClaw 桌面版",
    subtitle:
      "Windows 原生桌面应用。同样的 AutoClaw，独立窗口运行——带系统托盘、原生通知，还有可放进 U 盘随身携带的便携模式。",
    backHome: "返回首页",
    windows: "Windows",
    portableLabel: "便携版（U 盘版）",
    portableDesc:
      "免安装，双击即用。登录态与缓存保存在 .exe 同级的 AutoClaw-Data 文件夹里，拷到 U 盘即可在任意电脑使用，换机器免重登、不在宿主机留痕。32 位，兼容所有 32/64 位 Windows。",
    setupLabel: "安装版",
    setupDesc: "安装到本机（写入 %APPDATA%），自动创建开始菜单与桌面快捷方式。",
    download: "下载",
    recommended: "推荐",
    versionLabel: "版本",
    smartscreen: "尚未做代码签名——首次运行若被 SmartScreen 拦截，点「更多信息 → 仍要运行」。",
    allReleases: "查看所有版本与更新说明",
  },
  "zh-TW": {
    title: "下載 AutoClaw 桌面版",
    subtitle:
      "Windows 原生桌面應用。同樣的 AutoClaw，獨立視窗執行——附系統列圖示、原生通知，還有可放進 USB 隨身攜帶的可攜模式。",
    backHome: "返回首頁",
    windows: "Windows",
    portableLabel: "可攜版（USB 版）",
    portableDesc:
      "免安裝，雙擊即用。登入狀態與快取保存在 .exe 同層的 AutoClaw-Data 資料夾中，複製到 USB 即可在任意電腦使用，換機器免重登、不在主機留痕。32 位元，相容所有 32/64 位元 Windows。",
    setupLabel: "安裝版",
    setupDesc: "安裝至本機（寫入 %APPDATA%），自動建立開始功能表與桌面捷徑。",
    download: "下載",
    recommended: "推薦",
    versionLabel: "版本",
    smartscreen: "尚未進行程式碼簽章——首次執行若被 SmartScreen 攔截，點「更多資訊 → 仍要執行」。",
    allReleases: "檢視所有版本與更新說明",
  },
  ko: {
    title: "AutoClaw 데스크톱 다운로드",
    subtitle:
      "Windows용 네이티브 데스크톱 앱입니다. 같은 AutoClaw를 독립 창에서 실행하며, 시스템 트레이·네이티브 알림과 USB로 들고 다닐 수 있는 휴대용 모드를 제공합니다.",
    backHome: "홈으로 돌아가기",
    windows: "Windows",
    portableLabel: "휴대용(USB) 버전",
    portableDesc:
      "설치 없이 더블클릭으로 실행. 로그인 정보와 캐시가 .exe 옆 AutoClaw-Data 폴더에 저장되어, USB에 복사하면 어느 PC에서든 재로그인 없이 사용하고 호스트에 흔적을 남기지 않습니다. 32비트로 모든 32/64비트 Windows에서 동작합니다.",
    setupLabel: "설치 버전",
    setupDesc: "PC에 설치(%APPDATA%에 기록)하고 시작 메뉴와 바탕화면 바로 가기를 만듭니다.",
    download: "다운로드",
    recommended: "권장",
    versionLabel: "버전",
    smartscreen:
      "아직 코드 서명이 되어 있지 않습니다 — 첫 실행 시 SmartScreen이 차단하면 “추가 정보 → 실행”을 클릭하세요.",
    allReleases: "모든 버전 및 릴리스 노트",
  },
};

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  getDictionary(locale); // validate locale
  const t = copy[locale] || copy.en;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl font-bold">
            <span className="text-red-500">Auto</span>Claw
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher locale={locale} />
            <Link
              href={`/${locale}`}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              &larr; {t.backHome}
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-3">{t.title}</h1>
        <p className="text-gray-600 leading-relaxed mb-2 max-w-2xl">{t.subtitle}</p>
        <p className="text-sm text-gray-400 mb-10">
          {t.windows} &middot; {t.versionLabel} {DESKTOP.version}
        </p>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold">{t.portableLabel}</h2>
              <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {t.recommended}
              </span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed flex-1">{t.portableDesc}</p>
            <a
              href={DESKTOP.portable}
              className="mt-5 inline-flex items-center justify-center rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
            >
              {t.download} &middot; .exe
            </a>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h2 className="text-lg font-semibold mb-2">{t.setupLabel}</h2>
            <p className="text-sm text-gray-600 leading-relaxed flex-1">{t.setupDesc}</p>
            <a
              href={DESKTOP.setup}
              className="mt-5 inline-flex items-center justify-center rounded-lg border border-gray-300 hover:border-gray-400 text-gray-800 text-sm font-semibold px-4 py-2.5 transition-colors"
            >
              {t.download} &middot; Setup.exe
            </a>
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-6">{t.smartscreen}</p>

        <p className="mt-8">
          <a
            href={`${RELEASES_URL}/tag/${DESKTOP.tag}`}
            className="text-sm text-red-500 hover:text-red-600 transition-colors"
          >
            {t.allReleases} &rarr;
          </a>
        </p>
      </main>

      <footer className="bg-slate-900 text-gray-400 border-t border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-xs">
          <p>&copy; {new Date().getFullYear()} AutoClaw. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
