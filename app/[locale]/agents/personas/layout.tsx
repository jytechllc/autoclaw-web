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
      ? "人物增强 Agent 案例展示（即将上线）| AutoClaw"
      : "Persona-Enhanced Agents — Showcase (Coming Soon) | AutoClaw",
    description: isZh
      ? "AutoClaw 蒸馏出 15+ 角色 Agent——马斯克、纳瓦尔、芒格、费曼、乔布斯等——以他们的心智模型和决策启发式提升你的 AI 工作流。附真实市场案例与引用来源。"
      : "AutoClaw distills 15+ perspective agents — Musk, Naval, Munger, Feynman, Jobs and more — applying their mental models and decision heuristics to upgrade your AI workflow. With real, cited market case studies.",
  };
}

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
