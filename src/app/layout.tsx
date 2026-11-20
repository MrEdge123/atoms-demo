import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mini Atoms · AI 多智能体商业应用工作台',
  description:
    '从一句话想法到调研、方案确认、全栈构建、真实数据持久化与一键公网发布的 Route A+ Demo。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-[#f3f3f0] text-[#0c0c0c]/95 selection:bg-[#4267ff]/15 selection:text-[#0c0c0c]">
        {children}
      </body>
    </html>
  );
}
