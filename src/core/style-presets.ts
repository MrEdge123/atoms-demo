import type {
  DesignScenarioId,
  DesignSystemSpec,
  StyleThemeSpec,
} from '../domain';
import { DESIGN_SCENARIOS } from './design-guide';
import { styleThemeSchema } from './schemas';

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

const NAMED_CSS_HEX: Record<string, string> = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00FF00',
  aqua: '#00FFFF',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#FF00FF',
  purple: '#800080',
  orange: '#FFA500',
  ivory: '#FFFFF0',
  beige: '#F5F5DC',
  linen: '#FAF0E6',
  snow: '#FFFAFA',
  slate: '#64748B',
  slategray: '#708090',
  indigo: '#4B0082',
  coral: '#FF7F50',
  crimson: '#DC143C',
  gold: '#FFD700',
  amber: '#FFBF00',
  brown: '#A52A2A',
};

function clampByteToHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).toUpperCase().padStart(2, '0');
}

function parseRgbChannel(token: string): number | null {
  const trimmed = token.trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(trimmed)) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    return (pct / 100) * 255;
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    const num = Number.parseFloat(trimmed);
    if (!Number.isFinite(num) || num < 0 || num > 255) return null;
    return num;
  }
  return null;
}

function parseCssPercentage(token: string): number | null {
  const trimmed = token.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(trimmed)) return null;
  const pct = Number.parseFloat(trimmed.slice(0, -1));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return pct / 100;
}

function parseHueDegrees(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  const match = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? 'deg';
  const deg =
    unit === 'rad'
      ? (value * 180) / Math.PI
      : unit === 'turn'
        ? value * 360
        : value;
  return ((deg % 360) + 360) % 360;
}

function splitCssColorArgs(inner: string): string[] | null {
  if (inner.includes(',')) {
    const parts = inner.split(',').map((p) => p.trim());
    return parts.length === 3 || parts.length === 4 ? parts.slice(0, 3) : null;
  }
  const slashParts = inner.split('/').map((p) => p.trim());
  if (slashParts.length > 2) return null;
  const channels = slashParts[0].split(/\s+/).filter(Boolean);
  return channels.length === 3 ? channels : null;
}

/**
 * Normalizes legacy `#RGB`, `#RRGGBB`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`,
 * or named CSS colors into uppercase `#RRGGBB` hex, or returns `null` when unsupported.
 */
export function normalizeCssColorToHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const shortHex = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const [r, g, b] = shortHex[1].toUpperCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const fullHex = trimmed.match(/^#([0-9a-fA-F]{6})$/);
  if (fullHex) {
    return `#${fullHex[1].toUpperCase()}`;
  }

  const named = NAMED_CSS_HEX[trimmed.toLowerCase()];
  if (named) return named;

  const rgbMatch = trimmed.match(/^rgba?\(\s*([^)]+?)\s*\)$/i);
  if (rgbMatch) {
    const parts = splitCssColorArgs(rgbMatch[1]);
    if (!parts) return null;
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    if (r === null || g === null || b === null) return null;
    return `#${clampByteToHex(r)}${clampByteToHex(g)}${clampByteToHex(b)}`;
  }

  const hslMatch = trimmed.match(/^hsla?\(\s*([^)]+?)\s*\)$/i);
  if (hslMatch) {
    const parts = splitCssColorArgs(hslMatch[1]);
    if (!parts) return null;
    const h = parseHueDegrees(parts[0]);
    const s = parseCssPercentage(parts[1]);
    const l = parseCssPercentage(parts[2]);
    if (h === null || s === null || l === null) return null;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) {
      rp = c;
      gp = x;
    } else if (h < 120) {
      rp = x;
      gp = c;
    } else if (h < 180) {
      gp = c;
      bp = x;
    } else if (h < 240) {
      gp = x;
      bp = c;
    } else if (h < 300) {
      rp = x;
      bp = c;
    } else {
      rp = c;
      bp = x;
    }
    return `#${clampByteToHex((rp + m) * 255)}${clampByteToHex((gp + m) * 255)}${clampByteToHex((bp + m) * 255)}`;
  }

  return null;
}

/**
 * Attempts to upgrade a persisted/imported theme with legacy CSS color strings into
 * a strict hex `StyleThemeSpec`; returns `null` when validation fails.
 */
export function migrateLegacyStyleTheme(raw: unknown): StyleThemeSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  let candidate: Record<string, unknown> = { ...source };

  if (
    source.palette &&
    typeof source.palette === 'object' &&
    !Array.isArray(source.palette)
  ) {
    const pal = source.palette as Record<string, unknown>;
    const normalizedPalette: Record<string, unknown> = { ...pal };
    for (const key of [
      'background',
      'surface',
      'textPrimary',
      'textMuted',
      'accent',
    ]) {
      const val = pal[key];
      if (typeof val === 'string') {
        normalizedPalette[key] = normalizeCssColorToHex(val) ?? val;
      }
    }
    candidate = { ...candidate, palette: normalizedPalette };
  }

  const res = styleThemeSchema.safeParse(candidate);
  return res.success ? { ...res.data, isCustom: true } : null;
}

/**
 * Compares two `StyleThemeSpec` entries by visual and prompt content regardless of ID or hex casing.
 */
export function isSameThemeContent(
  a: StyleThemeSpec,
  b: StyleThemeSpec
): boolean {
  const normColor = (val: string) =>
    normalizeCssColorToHex(val) ?? val.trim().toLowerCase();
  const depthA =
    a.surfaceDepth ?? (a.colorMode === 'dark' ? 'stepped-dark' : 'hairline');
  const depthB =
    b.surfaceDepth ?? (b.colorMode === 'dark' ? 'stepped-dark' : 'hairline');

  return (
    a.name.trim() === b.name.trim() &&
    (a.description ?? '').trim() === (b.description ?? '').trim() &&
    (a.scenario ?? null) === (b.scenario ?? null) &&
    a.colorMode === b.colorMode &&
    normColor(a.palette.background) === normColor(b.palette.background) &&
    normColor(a.palette.surface) === normColor(b.palette.surface) &&
    normColor(a.palette.textPrimary) === normColor(b.palette.textPrimary) &&
    normColor(a.palette.textMuted) === normColor(b.palette.textMuted) &&
    normColor(a.palette.accent) === normColor(b.palette.accent) &&
    a.typography.headingStyle === b.typography.headingStyle &&
    a.typography.bodyStyle === b.typography.bodyStyle &&
    (a.radiusStyle ?? 'soft') === (b.radiusStyle ?? 'soft') &&
    depthA === depthB &&
    a.stylePrompt.trim() === b.stylePrompt.trim()
  );
}
