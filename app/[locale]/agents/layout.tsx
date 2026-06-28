import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale.startsWith("zh");
  return {
    title: isZh
      ? "AI 员工 Agent + 人物属性增强 | AutoClaw"
      : "AI Employee Agents + Persona Enhancement | AutoClaw",
    description: isZh
      ? "AutoClaw 的 General Agent 自主完成营销与销售工作，并即将推出人物属性增强——用顶尖头脑的心智模型与决策启发式，为不同任务提供更精准的推荐。"
      : "AutoClaw's General Agents autonomously run marketing and sales, with persona enhancement coming soon — using the mental models and decision heuristics of the best minds to power sharper, task-specific recommendations.",
  };
}

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
