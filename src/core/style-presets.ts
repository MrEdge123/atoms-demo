import type {
  DesignScenarioId,
  DesignSystemSpec,
  StyleThemeSpec,
} from '../domain';
import { DESIGN_SCENARIOS } from './design-guide';

export const BUILTIN_STYLE_THEMES: StyleThemeSpec[] = [
  {
    id: 'preset-brand-editorial',
    name: '叙事落地（品牌官网）',
    description: '暖白编辑大字 Hero + 单一学院蓝强调 + 叙事分屏留白',
    scenario: 'A',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.A.defaultPalette,
    typography: { headingStyle: 'editorial-serif', bodyStyle: 'sans' },
    radiusStyle: 'soft',
    surfaceDepth: 'hairline',
    stylePrompt:
      '全屏留白 Hero 配超大衬线标题（字距收紧），一屏专注讲一件事，使用 1px 细线区分叙事区块，强调色克制在主 CTA 与焦点状态（<10%）。禁止轮播图和弹窗打断。',
  },
  {
    id: 'preset-saas-precision',
    name: '精准白昼（SaaS 工作台）',
    description: '高可读浅灰白台面 + 精密等宽数字 + 1px 清晰信息网格',
    scenario: 'B',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.B.defaultPalette,
    typography: { headingStyle: 'geometric-sans', bodyStyle: 'sans' },
    radiusStyle: 'soft',
    surfaceDepth: 'hairline',
    stylePrompt:
      '单一几何无衬线字体搭配 tabular-nums 数据数字；12 列清晰卡片与 44px 行高列表；严禁彩虹图表与多层阴影堆叠，保留充足内边距与留白。',
  },
  {
    id: 'preset-gallery-studio',
    name: '北境画廊（创意作品集）',
    description: '瑞士非对称网格 + 直角细线框架 + 朱红艺术点缀',
    scenario: 'C',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.C.defaultPalette,
    typography: { headingStyle: 'editorial-serif', bodyStyle: 'sans' },
    radiusStyle: 'sharp',
    surfaceDepth: 'hairline',
    stylePrompt:
      '8/4 非对称瑞士网格、直角 1px #111 分割线、超大作品名/品牌名视觉排版与作品序号索引，搭配唯一朱红强调点，零廉价卡片阴影。',
  },
  {
    id: 'preset-craft-atelier',
    name: '匠心器物（消费与线下体验）',
    description: '亚麻暖纸底 + 陶土棕调点缀 + 物性风物叙事排版',
    scenario: 'D',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.D.defaultPalette,
    typography: { headingStyle: 'editorial-serif', bodyStyle: 'sans' },
    radiusStyle: 'soft',
    surfaceDepth: 'hairline',
    stylePrompt:
      '亚麻暖纸底 #FAF8F4 配深炭文字与陶土棕强调（<10%），衬线大标题营造手作匠心与线下空间温度；首屏以产品风味与精简线稿插画为主角，禁止出现 SaaS 统计卡片和打折轰炸标签。',
  },
  {
    id: 'preset-paper-journal',
    name: '纸质手记（内容与博客）',
    description: '书页米白 + 窄栏沉浸长文排版 + 深松绿克制点缀',
    scenario: 'E',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.E.defaultPalette,
    typography: { headingStyle: 'editorial-serif', bodyStyle: 'sans' },
    radiusStyle: 'sharp',
    surfaceDepth: 'hairline',
    stylePrompt:
      '680px 居中沉浸阅读列宽、两侧大幅留白、1.75 舒适行高与段落间距；衬线标题加细线目录索引，绝不堆叠花哨侧边挂件。',
  },
  {
    id: 'preset-mobile-companion',
    name: '轻触移动（H5 随行应用）',
    description: '拇指热区布局 + ≥44px 胶囊触控 + 户外高对比',
    scenario: 'F',
    colorMode: 'light',
    palette: DESIGN_SCENARIOS.F.defaultPalette,
    typography: { headingStyle: 'minimal-sans', bodyStyle: 'sans' },
    radiusStyle: 'pill',
    surfaceDepth: 'subtle-shadow',
    stylePrompt:
      '移动优先单栏紧凑卡片，所有主操作按钮 ≥44px 胶囊形且易于单手拇指触达，标题 22–28px 不臃肿，严格禁止横向溢出。',
  },
  {
    id: 'preset-obsidian-tech',
    name: '深空脉络（暗色科技专题）',
    description: '#0A0B10 深蓝黑阶梯 + 1px 微白边框 + 克制极光蓝',
    scenario: 'G',
    colorMode: 'dark',
    palette: DESIGN_SCENARIOS.G.defaultPalette,
    typography: { headingStyle: 'geometric-sans', bodyStyle: 'sans' },
    radiusStyle: 'soft',
    surfaceDepth: 'stepped-dark',
    stylePrompt:
      '深蓝黑明度阶梯（#0A0B10 背景 -> #12141C 卡片）配 1px rgba(255,255,255,0.08) 细边代替阴影，极光蓝 #5B8CFF 仅点亮关键 CTA 与激活焦点，禁用纯黑 #000000 与刺眼大面积霓虹渐变。',
  },
];

export function createUnthemedDesignSystem(
  scenario: DesignScenarioId = 'B'
): DesignSystemSpec {
  const def = DESIGN_SCENARIOS[scenario];
  return {
    scenario: def.id,
    scenarioName: def.name,
    tone: def.toneKeywords,
    colorMode: def.defaultColorMode,
    palette: { ...def.defaultPalette },
    typography: { ...def.defaultTypography },
    radiusStyle: def.defaultRadiusStyle,
    surfaceDepth: def.defaultSurfaceDepth,
    layoutBlueprint: def.layoutRules,
    visualFocalPoint: '首屏单一核心视觉焦点与 40–60% 呼吸留白构图',
    motionStyle: def.motionRules,
    mediaStrategy: def.mediaRule,
    antiPatterns: [...def.antiPatterns],
  };
}

export function applyThemeToDesignSystem(
  current: DesignSystemSpec | undefined,
  theme: StyleThemeSpec | null,
  fallbackBaseline?: DesignSystemSpec | null
): DesignSystemSpec | undefined {
  if (!theme) {
    if (fallbackBaseline && !fallbackBaseline.themeId) {
      return {
        ...fallbackBaseline,
        palette: { ...fallbackBaseline.palette },
        typography: { ...fallbackBaseline.typography },
        antiPatterns: [...fallbackBaseline.antiPatterns],
      };
    }
    if (!current) return undefined;
    return createUnthemedDesignSystem(current.scenario);
  }

  const scenario: DesignScenarioId = theme.scenario ?? current?.scenario ?? 'B';
  const def = DESIGN_SCENARIOS[scenario];
  const scenarioChanged = !current || current.scenario !== scenario;

  return {
    scenario,
    scenarioName: def.name,
    tone: theme.description || def.toneKeywords,
    colorMode: theme.colorMode,
    palette: { ...theme.palette },
    typography: {
      headingStyle: theme.typography.headingStyle,
      bodyStyle: theme.typography.bodyStyle,
      rationale: scenarioChanged
        ? def.defaultTypography.rationale
        : current.typography.rationale,
    },
    radiusStyle: theme.radiusStyle ?? def.defaultRadiusStyle,
    surfaceDepth: theme.surfaceDepth ?? def.defaultSurfaceDepth,
    layoutBlueprint: scenarioChanged ? def.layoutRules : current.layoutBlueprint,
    visualFocalPoint: scenarioChanged
      ? '首屏单一核心视觉焦点与 40–60% 呼吸留白构图'
      : current.visualFocalPoint,
    motionStyle: scenarioChanged ? def.motionRules : current.motionStyle,
    mediaStrategy: scenarioChanged
      ? def.mediaRule
      : (current.mediaStrategy ?? def.mediaRule),
    antiPatterns: scenarioChanged
      ? [...def.antiPatterns]
      : current.antiPatterns.length > 0
        ? [...current.antiPatterns]
        : [...def.antiPatterns],
    themeId: theme.id,
    themeName: theme.name,
    customStylePrompt: theme.stylePrompt,
  };
}
