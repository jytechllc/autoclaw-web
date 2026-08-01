// Industry budget benchmarks for the PMax quick-launch wizard.
//
// Goal (boss directive): a brand-new owner should never have to think about
// numbers — pick an industry and the wizard pre-fills a sane budget with a
// "this is what businesses like yours typically spend" hint.
//
// Figures are ESTIMATES for US small businesses, distilled from public
// 2024-25 search-ads benchmark reports (WordStream/LocaliQ tier). They are
// starting points, not promises — the UI labels them as estimates and the
// owner can always override. Suggested dailies are deliberately at the low
// end of viable: enough clicks/day for PMax to learn without scaring a small
// owner off ($ = USD).

export interface IndustryBenchmark {
  id: string;
  label: { en: string; zh: string; "zh-TW": string; ko: string };
  /** Typical search CPC in USD — shown as context, drives nothing. */
  avgCpcUsd: number;
  /** Suggested daily budgets: cautious / recommended / growth. */
  daily: { starter: number; recommended: number; aggressive: number };
}

export const INDUSTRY_BENCHMARKS: IndustryBenchmark[] = [
  { id: "restaurant", label: { en: "Restaurant / Food", zh: "餐饮", "zh-TW": "餐飲", ko: "요식업" }, avgCpcUsd: 1.9, daily: { starter: 10, recommended: 20, aggressive: 40 } },
  { id: "beauty", label: { en: "Beauty / Salon / Spa", zh: "美容美发", "zh-TW": "美容美髮", ko: "뷰티/미용" }, avgCpcUsd: 3.1, daily: { starter: 10, recommended: 20, aggressive: 40 } },
  { id: "home_services", label: { en: "Home Services / Remodeling", zh: "装修/家政服务", "zh-TW": "裝修/家事服務", ko: "홈서비스/리모델링" }, avgCpcUsd: 6.8, daily: { starter: 20, recommended: 40, aggressive: 80 } },
  { id: "cleaning", label: { en: "Cleaning Services", zh: "清洁服务", "zh-TW": "清潔服務", ko: "청소 서비스" }, avgCpcUsd: 4.9, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "moving", label: { en: "Moving / Hauling", zh: "搬家运输", "zh-TW": "搬家運輸", ko: "이사/운송" }, avgCpcUsd: 6.2, daily: { starter: 20, recommended: 40, aggressive: 80 } },
  { id: "auto", label: { en: "Auto Repair / Services", zh: "汽车维修", "zh-TW": "汽車維修", ko: "자동차 정비" }, avgCpcUsd: 3.6, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "dental", label: { en: "Dental", zh: "牙科诊所", "zh-TW": "牙科診所", ko: "치과" }, avgCpcUsd: 6.4, daily: { starter: 30, recommended: 60, aggressive: 120 } },
  { id: "medical", label: { en: "Medical / Clinic", zh: "医疗诊所", "zh-TW": "醫療診所", ko: "병원/클리닉" }, avgCpcUsd: 4.2, daily: { starter: 20, recommended: 40, aggressive: 80 } },
  { id: "legal", label: { en: "Legal Services", zh: "法律服务", "zh-TW": "法律服務", ko: "법률 서비스" }, avgCpcUsd: 9.6, daily: { starter: 50, recommended: 100, aggressive: 200 } },
  { id: "accounting", label: { en: "Accounting / Tax", zh: "会计报税", "zh-TW": "會計報稅", ko: "회계/세무" }, avgCpcUsd: 5.1, daily: { starter: 20, recommended: 40, aggressive: 80 } },
  { id: "insurance", label: { en: "Insurance", zh: "保险", "zh-TW": "保險", ko: "보험" }, avgCpcUsd: 11.8, daily: { starter: 40, recommended: 80, aggressive: 160 } },
  { id: "real_estate", label: { en: "Real Estate", zh: "房地产", "zh-TW": "房地產", ko: "부동산" }, avgCpcUsd: 2.6, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "retail", label: { en: "Retail / E-commerce", zh: "零售/电商", "zh-TW": "零售/電商", ko: "소매/이커머스" }, avgCpcUsd: 1.3, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "education", label: { en: "Education / Training", zh: "教育培训", "zh-TW": "教育培訓", ko: "교육/트레이닝" }, avgCpcUsd: 4.1, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "fitness", label: { en: "Fitness / Wellness", zh: "健身健康", "zh-TW": "健身健康", ko: "피트니스/웰니스" }, avgCpcUsd: 2.1, daily: { starter: 10, recommended: 20, aggressive: 40 } },
  { id: "travel", label: { en: "Travel / Tours", zh: "旅游", "zh-TW": "旅遊", ko: "여행" }, avgCpcUsd: 1.8, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "pets", label: { en: "Pet Services", zh: "宠物服务", "zh-TW": "寵物服務", ko: "반려동물 서비스" }, avgCpcUsd: 2.5, daily: { starter: 10, recommended: 20, aggressive: 40 } },
  { id: "photography", label: { en: "Photography / Events", zh: "摄影/活动", "zh-TW": "攝影/活動", ko: "사진/이벤트" }, avgCpcUsd: 2.0, daily: { starter: 10, recommended: 20, aggressive: 40 } },
  { id: "it_services", label: { en: "IT / Software Services", zh: "IT/软件服务", "zh-TW": "IT/軟體服務", ko: "IT/소프트웨어" }, avgCpcUsd: 5.3, daily: { starter: 20, recommended: 40, aggressive: 80 } },
  { id: "wholesale", label: { en: "Trade / Wholesale", zh: "贸易批发", "zh-TW": "貿易批發", ko: "무역/도매" }, avgCpcUsd: 2.4, daily: { starter: 15, recommended: 30, aggressive: 60 } },
  { id: "other", label: { en: "Other", zh: "其他", "zh-TW": "其他", ko: "기타" }, avgCpcUsd: 3.0, daily: { starter: 10, recommended: 20, aggressive: 40 } },
];

export function findBenchmark(id: string): IndustryBenchmark | undefined {
  return INDUSTRY_BENCHMARKS.find((b) => b.id === id);
}

export interface BudgetSuggestion {
  dailyBudget: number;
  /** Lifetime cap: one month at the suggested daily. */
  totalBudget: number;
  /** Peer range shown as the "businesses like yours spend…" hint. */
  peerDailyMin: number;
  peerDailyMax: number;
  avgCpcUsd: number;
}

/** Pure: industry → pre-filled budget. Unknown industry falls back to "other". */
export function suggestBudget(industryId: string): BudgetSuggestion {
  const b = findBenchmark(industryId) ?? findBenchmark("other")!;
  return {
    dailyBudget: b.daily.recommended,
    totalBudget: b.daily.recommended * 30,
    peerDailyMin: b.daily.starter,
    peerDailyMax: b.daily.aggressive,
    avgCpcUsd: b.avgCpcUsd,
  };
}

export function industryLabel(b: IndustryBenchmark, locale: string): string {
  if (locale === "zh") return b.label.zh;
  if (locale === "zh-TW") return b.label["zh-TW"];
  if (locale === "ko") return b.label.ko;
  return b.label.en;
}
