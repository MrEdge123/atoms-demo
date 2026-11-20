import type {
  DesignScenarioId,
  DesignSystemSpec,
  ProductPlan,
  StyleThemeSpec,
} from '../domain';

export interface RaceStyleDirection {
  branchId: string;
  label: string;
  styleDirection: string;
  colorMode: 'light' | 'dark';
  palette: DesignSystemSpec['palette'];
  surfaceDepth: NonNullable<DesignSystemSpec['surfaceDepth']>;
  radiusStyle?: NonNullable<DesignSystemSpec['radiusStyle']>;
}

export interface DesignScenarioDefinition {
  id: DesignScenarioId;
  name: string;
  shortLabel: string;
  keywords: string;
  toneKeywords: string;
  defaultColorMode: 'light' | 'dark';
  defaultPalette: DesignSystemSpec['palette'];
  defaultTypography: DesignSystemSpec['typography'];
  defaultRadiusStyle: NonNullable<DesignSystemSpec['radiusStyle']>;
  defaultSurfaceDepth: NonNullable<DesignSystemSpec['surfaceDepth']>;
  layoutRules: string;
  colorRules: string;
  typographyRules: string;
  motionRules: string;
  mediaRule: string;
  antiPatterns: string[];
  raceDirections: [RaceStyleDirection, RaceStyleDirection];
}

export const DESIGN_SCENARIOS: Record<DesignScenarioId, DesignScenarioDefinition> = {
  A: {
    id: 'A',
    name: '品牌官网 / 产品营销页',
    shortLabel: '品牌营销',
    keywords: '品牌发布、官网介绍、营销落地页、候补名单、活动推介',
    toneKeywords: '视觉冲击、叙事感、克制高级、高转化焦点',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#F6F5F1',
      surface: '#FFFFFF',
      textPrimary: '#141413',
      textMuted: '#63625E',
      accent: '#2B4C7E',
    },
    defaultTypography: {
      headingStyle: 'editorial-serif',
      bodyStyle: 'sans',
      rationale: '编辑感衬线大标题建立品牌格调，配合克制无衬线正文强化信任与可读性。',
    },
    defaultRadiusStyle: 'soft',
    defaultSurfaceDepth: 'hairline',
    layoutRules:
      '全屏留白 Hero（超大标题占屏宽 70%+ + 一句话价值主张 + 1 个主 CTA）→ 一屏只讲一件事的叙事节律（12 列非对称网格与 1px 细线分区）→ 克制社会证明/核心能力区 → 首尾呼应 CTA 与完整业务交互。',
    colorRules:
      '90% 以上采用暖米白/纯黑等高质感中性色；品牌主色占 <10%，仅用于主 CTA、活动状态点与焦点环；文字禁止使用彩色渐变。',
    typographyRules:
      'Hero 标题 48–76px（clamp 响应式）、line-height 1.05–1.12、letter-spacing -0.03em；正文 16px/1.65，每段不超过 3 行；数据编号使用 tabular-nums。',
    motionRules:
      '200–500ms cubic-bezier(0.22,1,0.36,1) 柔和位移渐现与按钮微反馈，首屏关键信息立即可见，不阻塞阅读与操作。',
    mediaRule:
      '严禁伪造外链图片 URL；Hero 主视觉优先以超大编辑排版 + 极简线条品牌徽记/几何构图 + 关键数字卡片承担，辅以克制纸感纹理。',
    antiPatterns: ['禁止轮播图与弹窗打断', '禁止单屏超过 3 个抢眼 CTA', '禁止彩虹渐变文字和花哨粒子遮字'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 暖白叙事杂志风',
        styleDirection:
          'Editorial light brand canvas (#F6F5F1 background, #FFFFFF hairline-bordered panels, oversized serif Hero title with negative tracking, >45% whitespace, single muted slate-indigo accent <10%).',
        colorMode: 'light',
        palette: {
          background: '#F6F5F1',
          surface: '#FFFFFF',
          textPrimary: '#141413',
          textMuted: '#63625E',
          accent: '#2B4C7E',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'soft',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 深炭剧场沉浸风',
        styleDirection:
          'Atmospheric charcoal dark brand stage (#0E0F12 background, #16181D stepped cards, 1px rgba(255,255,255,0.09) borders, bold editorial contrast and crisp warm-amber CTA accent <10%).',
        colorMode: 'dark',
        palette: {
          background: '#0E0F12',
          surface: '#16181D',
          textPrimary: '#F3F2EE',
          textMuted: '#9B9A94',
          accent: '#D49A4A',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'soft',
      },
    ],
  },
  B: {
    id: 'B',
    name: 'SaaS 产品 / 工作台仪表盘',
    shortLabel: 'SaaS 工作台',
    keywords: 'CRM、控制台、后台管理、活动签到管理、团队协作台、数据看板',
    toneKeywords: '清晰精密、高效可信、低噪结构化、零多余装饰',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#F7F7F5',
      surface: '#FFFFFF',
      textPrimary: '#111214',
      textMuted: '#66686E',
      accent: '#2554D7',
    },
    defaultTypography: {
      headingStyle: 'geometric-sans',
      bodyStyle: 'sans',
      rationale: '单一几何无衬线家族配合等宽 tabular-nums 数字，保证数据密度分级与高频扫描效率。',
    },
    defaultRadiusStyle: 'soft',
    defaultSurfaceDepth: 'hairline',
    layoutRules:
      '浅色清晰工作台：顶部紧凑导航/状态条（或 240px 侧栏）+ 12 列卡片网格（间距 16–24px、内边距 20–24px）；概览指标区低密度（32–44px 大数字+12px 灰标签）与明细表高密度（44px 行高+小字表头）清晰分层。',
    colorRules:
      '浅色为主，靠灰阶明度区分主次；语义色极克制（成功绿/警告橙/错误红各一色一阶，禁用高饱和荧光）；单主色 <10%。',
    typographyRules:
      '全站同一无衬线字体 + 等宽数字（tabular-nums）；大指标 32–44px Bold、标签 12px 灰色；表头紧凑克制。',
    motionRules:
      '仅保留 150–250ms ease-out 微交互（hover 切换、加载骨架与状态反馈），禁止装饰性浮动动画。',
    mediaRule:
      '信息效率与数据操作优先，不用无意义配图，改用清晰状态点、结构化进度条或极简单色趋势图形。',
    antiPatterns: ['禁止彩虹色图表或 3D 饼图', '禁止多层重阴影堆叠卡片', '禁止高饱和大面积背景色块'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 极简亮色精准工作台',
        styleDirection:
          'Clean light precision SaaS workspace (#F7F7F5 canvas, crisp #FFFFFF 1px-bordered cards, #2554D7 focused primary actions <10%, tabular-nums KPI strip, 44px row tables, generous breathing whitespace).',
        colorMode: 'light',
        palette: {
          background: '#F7F7F5',
          surface: '#FFFFFF',
          textPrimary: '#111214',
          textMuted: '#66686E',
          accent: '#2554D7',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'soft',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 暗夜极客终端风',
        styleDirection:
          'Modern dark executive dashboard (bg-slate-950 / #020617 canvas, #0F172A stepped cards, 1px rgba(255,255,255,0.08) hairline dividers, crisp emerald-400/500 accent <10%, tabular-nums metrics).',
        colorMode: 'dark',
        palette: {
          background: '#020617',
          surface: '#0F172A',
          textPrimary: '#F1F5F9',
          textMuted: '#94A3B8',
          accent: '#10B981',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'soft',
      },
    ],
  },
  C: {
    id: 'C',
    name: '个人作品集 / 创意工作室',
    shortLabel: '创意作品集',
    keywords: '摄影、设计师作品集、建筑工作室、策展空间、创意品牌',
    toneKeywords: '个性表达、强烈艺术方向、画廊级呼吸感、令人过目难忘',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#F4F2EE',
      surface: '#FFFFFF',
      textPrimary: '#111111',
      textMuted: '#6E6B65',
      accent: '#C93B2B',
    },
    defaultTypography: {
      headingStyle: 'editorial-serif',
      bodyStyle: 'sans',
      rationale: '超大品牌名与中英混排节奏本身即为图形焦点，衬线与等宽编号制造画廊目录感。',
    },
    defaultRadiusStyle: 'sharp',
    defaultSurfaceDepth: 'hairline',
    layoutRules:
      '打破对称模板感：允许 8/4 或 7/5 非对称布局、出血大画幅展示块、编号作品索引列表（大图视觉 + 极简元数据，hover 展开交互预览）。',
    colorRules:
      '极致黑白/暖石中性底衬托作品本身色彩，或大胆克制单一强调色（如朱红/克莱因蓝 <10%）。',
    typographyRules:
      '允许 Hero 标题占屏宽 75%+（clamp(3rem,8vw,6rem)）、紧密行高 0.98–1.08、横竖或中英等宽混排，正文阅读区保持静默可读。',
    motionRules:
      '250–600ms cubic-bezier(0.22,1,0.36,1) 流畅镜头感过渡与作品列表 hover 位移，严格保留 prefers-reduced-motion 降级。',
    mediaRule:
      '严禁外链假图，可用精致比例 SVG 抽象建筑/几何视觉画框或双色调渐变构图代表每件作品封面，保证 0 破图。',
    antiPatterns: ['禁止平庸三列等宽头像简历模板', '禁止过长首屏遮罩加载动画', '禁止作品预览区文字拥挤'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 瑞士画廊极简白',
        styleDirection:
          'Minimal Swiss architectural gallery (#F4F2EE warm gallery paper, sharp 0-radius 1px #111 rules, oversized editorial typography, asymmetric 8/4 grid, vermilion #C93B2B accent <10%).',
        colorMode: 'light',
        palette: {
          background: '#F4F2EE',
          surface: '#FFFFFF',
          textPrimary: '#111111',
          textMuted: '#6E6B65',
          accent: '#C93B2B',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'sharp',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 暗调先锋艺术馆',
        styleDirection:
          'Dark avant-garde studio exhibition (#0D0D10 deep obsidian canvas, 1px rgba(255,255,255,0.1) exhibition frames, stark off-white typography, crisp lime/vermilion highlight <10%).',
        colorMode: 'dark',
        palette: {
          background: '#0D0D10',
          surface: '#16161B',
          textPrimary: '#F5F4F0',
          textMuted: '#94938E',
          accent: '#E04F33',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'sharp',
      },
    ],
  },
  D: {
    id: 'D',
    name: '电商 / 消费产品与体验预约',
    shortLabel: '消费品牌',
    keywords: '手冲咖啡、烘焙工坊、手作陶瓷、茶饮、精选商店、线下预约、会员认购',
    toneKeywords: '物性材质质感、可信温度、购买与预约引导、零廉价促销感',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#FAF8F4',
      surface: '#FFFFFF',
      textPrimary: '#1D1916',
      textMuted: '#6E665E',
      accent: '#9A522B',
    },
    defaultTypography: {
      headingStyle: 'editorial-serif',
      bodyStyle: 'sans',
      rationale: '衬线体呈现品牌名称与风味/工艺质感，配合清晰无衬线参数表与等宽价格/时间数字。',
    },
    defaultRadiusStyle: 'soft',
    defaultSurfaceDepth: 'hairline',
    layoutRules:
      '非对称产品/工艺叙事首屏（产品视觉主角占比 50%+ 与名称→价格/风味参数→核心预约/选购 CTA→产地与会员保障固定秩序）+ 工艺故事块与简洁预约/订单工作区（单行紧凑列表，40–60% 留白）。',
    colorRules:
      '取色自产品自然材质（米白亚麻 #FAF8F4、暖灰、烘焙赭石/陶土棕 #9A522B <10%、深炭墨字 #1D1916），严禁出现软件后台风的霓虹绿/电子蓝！',
    typographyRules:
      '品牌与单品主标题使用衬线编辑体（.font-editorial），字号对比 ≥3 倍；产地/烘焙度/价格使用清晰分层与 tabular-nums，描述短句分点。',
    motionRules:
      '200–450ms ease-out 细腻过渡（筛选切换、加入清单/预约确认反馈），禁用炫技弹跳。',
    mediaRule:
      '严禁外链图片；使用高质感定制内联 SVG 器物/咖啡器具/风味风轮线稿插画与风味风物卡片呈现产品主角感，配色与暖纸底统一。',
    antiPatterns: ['禁止SaaS暗黑荧光绿面板套壳', '禁止促销倒计时弹窗与满屏打折Badge角标轰炸', '禁止一屏堆砌 4 个彩虹数据统计卡'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 暖纸编辑匠心风',
        styleDirection:
          'Warm tactile craft & editorial commerce (#FAF8F4 linen paper background, #FFFFFF hairline cards, #1D1916 espresso ink, terracotta-roast #9A522B accent <10%, .font-editorial serif hero headings, 50%+ product & origin storytelling area, bespoke line-art SVG vessel/coffee illustration).',
        colorMode: 'light',
        palette: {
          background: '#FAF8F4',
          surface: '#FFFFFF',
          textPrimary: '#1D1916',
          textMuted: '#6E665E',
          accent: '#9A522B',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'soft',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 暗调精品工坊风',
        styleDirection:
          'Intimate dark tasting atelier (#110F0E warm obsidian charcoal, #1A1715 stepped surface, 1px rgba(255,248,240,0.1) hairline borders, muted burnished-amber #D4894A accent <10%, .font-editorial serif display typography, zero neon SaaS greens).',
        colorMode: 'dark',
        palette: {
          background: '#110F0E',
          surface: '#1A1715',
          textPrimary: '#F4EFE8',
          textMuted: '#A19990',
          accent: '#D4894A',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'soft',
      },
    ],
  },
  E: {
    id: 'E',
    name: '内容 / 媒体 / 独立笔记与博客',
    shortLabel: '编辑出版',
    keywords: '独立博客、数字笔记、深度专栏、杂志期刊、知识库、影评/书评',
    toneKeywords: '阅读沉浸、纸张刊物感、克制精良排版',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#FAFAF7',
      surface: '#FFFFFF',
      textPrimary: '#1A1A1A',
      textMuted: '#686762',
      accent: '#2E5B4E',
    },
    defaultTypography: {
      headingStyle: 'editorial-serif',
      bodyStyle: 'sans',
      rationale: '标题采用高辨识度衬线体建立刊物权威感，正文控制严格行长与 1.7 行高保证长文零疲劳阅读。',
    },
    defaultRadiusStyle: 'sharp',
    defaultSurfaceDepth: 'hairline',
    layoutRules:
      '阅读优先栏宽（正文内容居中限宽 640–720px，两侧大片留白）+ 目录/标签切换精简有序；文章/笔记卡采用大标题 + 清晰分类标签与发布日期，支持引用块与正文详略切换。',
    colorRules:
      '纸张暖白 #FAFAF7 底 + 近黑 #1A1A1A 文字（不用刺眼纯黑 #000），点缀单一深墨绿/铁锈红强调色 <10%。',
    typographyRules:
      '正文 16–18px、行高 1.65–1.8、中文每行 24–36 字、段落间距 ≥1.5em（不用首行缩进）；标题与正文字号差 ≥2.5 倍。',
    motionRules:
      '极简：仅阅读切换淡入或顶部细阅读进度提示，绝不在正文滚动区触发眩晕动画。',
    mediaRule:
      '以文字与排版节奏为主视觉，配以精细 1px 细线分隔与目录序号；如加配图使用极简几何版画式 SVG 题图。',
    antiPatterns: ['禁止正文两旁塞满花哨侧边小挂件', '禁止密集多色标签云', '禁止过宽（>850px）导致眼球换行疲劳的正文排版'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 纸感杂志长文风',
        styleDirection:
          'Editorial paper print magazine (#FAFAF7 paper canvas, #1A1A1A soft ink, crisp 1px borders, centered 680px reading measure, .font-editorial serif headings, deep botanical green #2E5B4E accent <10%).',
        colorMode: 'light',
        palette: {
          background: '#FAFAF7',
          surface: '#FFFFFF',
          textPrimary: '#1A1A1A',
          textMuted: '#686762',
          accent: '#2E5B4E',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'sharp',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 暗夜书房阅读风',
        styleDirection:
          'Night-owl editorial reading room (#121210 warm dark inkwell, #1B1B18 reading surface, #EAE6DD soft ivory text, warm parchment #D6A86E accent <10%, serif display headlines with generous line-height).',
        colorMode: 'dark',
        palette: {
          background: '#121210',
          surface: '#1B1B18',
          textPrimary: '#EAE6DD',
          textMuted: '#9C968B',
          accent: '#D6A86E',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'sharp',
      },
    ],
  },
  F: {
    id: 'F',
    name: '移动端 H5 / 随行轻应用',
    shortLabel: '移动轻应用',
    keywords: '打卡工具、现场扫码签到、轻点单、活动随行助手、移动端H5',
    toneKeywords: '单手拇指友好、高触达效率、轻快直观',
    defaultColorMode: 'light',
    defaultPalette: {
      background: '#F7F7F5',
      surface: '#FFFFFF',
      textPrimary: '#121316',
      textMuted: '#686B73',
      accent: '#2062E8',
    },
    defaultTypography: {
      headingStyle: 'minimal-sans',
      bodyStyle: 'sans',
      rationale: '移动端禁用占屏过高的超大标题，依靠清晰字重差与 ≥44px 触控热区提升操作效率。',
    },
    defaultRadiusStyle: 'pill',
    defaultSurfaceDepth: 'subtle-shadow',
    layoutRules:
      '移动优先单栏居中容器（桌面浏览时居中 max-w-[480px] 卡片流或自然适配）+ 核心操作落在下半屏拇指热区 + 顶部精简状态与 3–5 项底部标签导航。',
    colorRules:
      '户外强光高对比度（正文对比度 ≥4.5:1），高明度洁净背景配唯一核心强调色 <10%。',
    typographyRules:
      '标题 22–28px Bold、正文 15–16px、禁止出现 <12px 的难以辨认小字；所有点击按钮高度 ≥44px。',
    motionRules:
      '200–320ms 轻快物理弹性缓动，零 hover 态强依赖。',
    mediaRule:
      '采用清晰图标徽章与紧凑状态卡片，确保首屏无需长距离滚动即可触发核心动作。',
    antiPatterns: ['禁止直接把桌面多列宽表格硬缩进手机宽度', '禁止按钮高度低于 44px', '禁止强依赖鼠标 hover 才显示关键信息'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 轻盈暖白拇指流',
        styleDirection:
          'Thumb-first mobile-native light utility (#F7F7F5 canvas, crisp white cards, >=44px pill buttons, clean bottom tab navigation, #2062E8 focus accent <10%, zero desktop clutter).',
        colorMode: 'light',
        palette: {
          background: '#F7F7F5',
          surface: '#FFFFFF',
          textPrimary: '#121316',
          textMuted: '#686B73',
          accent: '#2062E8',
        },
        surfaceDepth: 'subtle-shadow',
        radiusStyle: 'pill',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 暗调夜间随行风',
        styleDirection:
          'High-contrast dark mobile companion (#0E1014 canvas, #171A20 stepped cards, >=44px pill controls, bright legible #38BDF8 accent <10%, bottom-anchored thumb actions).',
        colorMode: 'dark',
        palette: {
          background: '#0E1014',
          surface: '#171A20',
          textPrimary: '#F3F4F6',
          textMuted: '#949AA6',
          accent: '#38BDF8',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'pill',
      },
    ],
  },
  G: {
    id: 'G',
    name: '深色模式 / 科技与 AI 专题',
    shortLabel: '深色科技',
    keywords: 'AI 工具、音视频产品、开发者工具、硬件官网、夜间场景体验',
    toneKeywords: '深邃沉浸、精密光学感、高级克制科技氛围',
    defaultColorMode: 'dark',
    defaultPalette: {
      background: '#0A0B10',
      surface: '#12141C',
      textPrimary: '#F3F4F6',
      textMuted: '#9499A6',
      accent: '#5B8CFF',
    },
    defaultTypography: {
      headingStyle: 'geometric-sans',
      bodyStyle: 'sans',
      rationale: '锐利几何无衬线搭配等宽代码/参数标识，强化深空界面的工程精密感。',
    },
    defaultRadiusStyle: 'soft',
    defaultSurfaceDepth: 'stepped-dark',
    layoutRules:
      '明度阶梯分层（#0A0B10 画布 → #12141C 卡片 +4~8% 明度 → #1A1D28 浮层），使用 1px rgba(255,255,255,0.08) 半透明白边代替无效阴影，大留白突出单一产品/模型交互舞台。',
    colorRules:
      '严禁纯黑 #000000 死白对比；采用深蓝黑/炭黑阶梯 + 高明度但克制的主强调色 <10%，光晕 glow 仅点缀焦点边界且极淡。',
    typographyRules:
      '几何无衬线标题（tracking -0.025em）+ mono 标签/版本号，正文保留柔和灰白保证阅读舒适度。',
    motionRules:
      '250–500ms cubic-bezier(0.22,1,0.36,1) 精密响应与极微光边过渡，禁止炫目闪烁干扰操作。',
    mediaRule:
      '以低对比度深色网格线、精密单线 SVG 波形/架构图取代俗套霓虹全息大图。',
    antiPatterns: ['禁止纯黑 #000 背景配刺眼紫红全屏霓虹光斑', '禁止深色界面强加黑阴影（根本看不见）', '禁止正文使用低对比度深灰字'],
    raceDirections: [
      {
        branchId: 'branch-a',
        label: '方案 A · 深空精密光学风',
        styleDirection:
          'Stepped dark obsidian tech showcase (#0A0B10 canvas -> #12141C surface, 1px rgba(255,255,255,0.08) hairline edges, subtle single-focus #5B8CFF accent <10%, geometric sans + mono precision specs).',
        colorMode: 'dark',
        palette: {
          background: '#0A0B10',
          surface: '#12141C',
          textPrimary: '#F3F4F6',
          textMuted: '#9499A6',
          accent: '#5B8CFF',
        },
        surfaceDepth: 'stepped-dark',
        radiusStyle: 'soft',
      },
      {
        branchId: 'branch-b',
        label: '方案 B · 冰白高反差实验室风',
        styleDirection:
          'Stark laboratory daylight contrast (#F8F9FB cool mineral white, #0F1115 obsidian typography & primary actions, 1px crisp architectural rules, precision mono labels).',
        colorMode: 'light',
        palette: {
          background: '#F8F9FB',
          surface: '#FFFFFF',
          textPrimary: '#0F1115',
          textMuted: '#5C6270',
          accent: '#1E293B',
        },
        surfaceDepth: 'hairline',
        radiusStyle: 'soft',
      },
    ],
  },
};

export function getScenarioDefinition(
  scenario?: DesignScenarioId | null
): DesignScenarioDefinition {
  if (scenario && scenario in DESIGN_SCENARIOS) {
    return DESIGN_SCENARIOS[scenario];
  }
  return DESIGN_SCENARIOS.B;
}

export function getRaceDirectionsForPlan(
  plan?: ProductPlan | null
): RaceStyleDirection[] {
  const ds = plan?.designSystem;
  const scenarioDef = getScenarioDefinition(ds?.scenario);
  const [dirA, dirB] = scenarioDef.raceDirections;

  if (ds) {
    const themeDetail = [
      ds.themeName ? `Theme "${ds.themeName}"` : `Scenario ${scenarioDef.id} confirmed plan`,
      `Palette bg=${ds.palette.background} surface=${ds.palette.surface} text=${ds.palette.textPrimary} accent=${ds.palette.accent}`,
      ds.customStylePrompt ? `User directive: ${ds.customStylePrompt}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const contrasting = ds.colorMode === dirB.colorMode ? dirA : dirB;
    return [
      {
        branchId: 'branch-a',
        label: ds.themeName ? `方案 A · ${ds.themeName}` : '方案 A · 确认方案标准实现',
        styleDirection: `Follow the confirmed DesignSystemSpec strictly: ${themeDetail}.`,
        colorMode: ds.colorMode,
        palette: { ...ds.palette },
        surfaceDepth:
          ds.surfaceDepth ??
          (ds.colorMode === 'dark' ? 'stepped-dark' : 'hairline'),
        radiusStyle: ds.radiusStyle ?? scenarioDef.defaultRadiusStyle,
      },
      {
        branchId: 'branch-b',
        label: `方案 B · ${contrasting.label.replace(/^方案\s*[AB]\s*·\s*/, '')}（同场景对比）`,
        styleDirection: contrasting.styleDirection,
        colorMode: contrasting.colorMode,
        palette: { ...contrasting.palette },
        surfaceDepth: contrasting.surfaceDepth,
        radiusStyle: contrasting.radiusStyle,
      },
    ];
  }

  return [dirA, dirB];
}

export function resolveBranchDesignSystem(
  plan: ProductPlan,
  dir: RaceStyleDirection
): DesignSystemSpec {
  const baseDs = plan.designSystem;
  const def = getScenarioDefinition(baseDs?.scenario);

  if (
    dir.branchId === 'branch-a' &&
    baseDs &&
    dir.colorMode === baseDs.colorMode &&
    dir.palette.background.toLowerCase() === baseDs.palette.background.toLowerCase() &&
    dir.palette.accent.toLowerCase() === baseDs.palette.accent.toLowerCase()
  ) {
    return {
      ...baseDs,
      palette: { ...baseDs.palette },
      typography: { ...baseDs.typography },
      antiPatterns: [...baseDs.antiPatterns],
    };
  }

  const branchShortLabel = dir.label
    .replace(/^方案\s*[AB]\s*·\s*/, '')
    .replace(/（同场景对比）$/, '');
  const branchTone = `${branchShortLabel}（${dir.colorMode === 'dark' ? '深色沉浸' : '浅色明净'} · ${def.shortLabel}）`;
  const contrastLayoutBlueprint =
    dir.colorMode !== def.defaultColorMode
      ? `${dir.colorMode === 'dark' ? '深色明度阶梯分层' : '浅色留白构图分层'}（主画布 ${dir.palette.background} → 卡片容器 ${dir.palette.surface}），${dir.surfaceDepth === 'stepped-dark' ? '使用 1px rgba(255,255,255,0.08) 半透明描边替代黑阴影' : '以 1px 柔和描边或极轻阴影建立清晰秩序'}，保持 40–60% 呼吸留白与单一视觉焦点。`
      : def.layoutRules;

  return {
    scenario: def.id,
    scenarioName: baseDs?.scenarioName || def.name,
    tone: branchTone,
    colorMode: dir.colorMode,
    palette: { ...dir.palette },
    typography: baseDs?.typography
      ? { ...baseDs.typography }
      : { ...def.defaultTypography },
    radiusStyle: dir.radiusStyle ?? baseDs?.radiusStyle ?? def.defaultRadiusStyle,
    surfaceDepth: dir.surfaceDepth,
    layoutBlueprint: contrastLayoutBlueprint,
    visualFocalPoint:
      baseDs?.visualFocalPoint || '首屏单一核心视觉焦点与 40–60% 呼吸留白构图',
    motionStyle: baseDs?.motionStyle || def.motionRules,
    mediaStrategy: baseDs?.mediaStrategy || def.mediaRule,
    antiPatterns: [...def.antiPatterns],
  };
}

export function renderDesignMarkdown(
  plan: ProductPlan,
  opts?: { branchLabel?: string; branchStyleDirection?: string }
): string {
  const ds = plan.designSystem;
  const def = getScenarioDefinition(ds?.scenario);
  const palette = ds?.palette ?? def.defaultPalette;
  const typography = ds?.typography ?? def.defaultTypography;
  const colorMode = ds?.colorMode ?? def.defaultColorMode;
  const radiusStyle = ds?.radiusStyle ?? def.defaultRadiusStyle;
  const surfaceDepth = ds?.surfaceDepth ?? def.defaultSurfaceDepth;
  const antiPatterns =
    ds?.antiPatterns && ds.antiPatterns.length > 0
      ? ds.antiPatterns
      : def.antiPatterns;

  const headingFontNote =
    typography.headingStyle === 'editorial-serif'
      ? '主标题使用衬线编辑体（className="font-editorial"，思源宋体 / Georgia 栈），字距 -0.025em，与正文字重拉出强对比'
      : typography.headingStyle === 'geometric-sans'
        ? '主标题使用几何无衬线（className="font-display"，Inter / 思源黑体栈），Bold/Light 字重对比，字距 -0.02em'
        : '主标题使用极简无衬线（className="font-display"，克制字重），依赖留白与字阶区分层级';

  const bodyFontNote =
    typography.bodyStyle === 'serif'
      ? '正文使用衬线体（font-editorial），16–17px / 行高 1.7'
      : '正文使用无衬线（font-display），15–16px / 行高 1.65，数据/编号/时间使用 className="font-mono tabular-nums"';

  const radiusNote =
    radiusStyle === 'sharp'
      ? '整体形状语言：克制直角/微圆角（卡片 rounded-sm 0–4px + 行动按钮 rounded-full 胶囊，全站不超过 2 种圆角）'
      : radiusStyle === 'pill'
        ? '整体形状语言：圆润卡片（rounded-2xl 16px）+ 胶囊按钮（rounded-full），全站不超过 2 种圆角'
        : '整体形状语言：精炼小圆角（卡片 rounded-lg 8px + 行动按钮 rounded-full 胶囊，全站不超过 2 种圆角）';

  const depthNote =
    surfaceDepth === 'stepped-dark'
      ? `深色明度阶梯（背景 ${palette.background} → 卡片 ${palette.surface}），禁止黑阴影，使用 1px rgba(255,255,255,0.08) 半透明白边分层`
      : surfaceDepth === 'subtle-shadow'
        ? '以极轻细腻投影与 1px 柔和描边建立浮起层次'
        : '以 1px 细边与表面色差建立静谧层次，减少冗余投影堆叠';

  const lines: string[] = [
    `# DESIGN — ${plan.appName}`,
    '',
    '## Direction & Layout',
    `- **识别场景**：场景 ${def.id} · ${ds?.scenarioName || def.name}（模式：${colorMode === 'dark' ? '深色沉浸' : '浅色明净'}）`,
    `- **目标气质**：${ds?.tone || def.toneKeywords}`,
    `- **单页视觉焦点**：${ds?.visualFocalPoint || '首屏超大排版与核心交互区形成唯一主焦点，四周留出 40%–60% 呼吸留白'}`,
    `- **布局蓝图**：${ds?.layoutBlueprint || def.layoutRules}`,
  ];

  if (ds?.themeName) {
    lines.push(`- **选用主题**：${ds.themeName}`);
  }
  if (ds?.customStylePrompt) {
    lines.push(`- **自定义风格指令（高优先级）**：${ds.customStylePrompt}`);
  }
  if (opts?.branchLabel || opts?.branchStyleDirection) {
    lines.push(
      `- **Race 分支方向（${opts.branchLabel ?? '当前分支'}）**：${opts.branchStyleDirection ?? ''}`
    );
  }

  lines.push(
    `- **Do**：留白占比 40%–60%；8px 间距倍数体系；标题与正文字号至少 2.5 倍以上对比；仅 1 处主导强调色（占比 <10%）。`,
    `- **Don't**：${antiPatterns.join('；')}。`,
    '',
    '## Tokens',
    `- **颜色角色**（主色占比严格 <10%）：背景 \`${palette.background}\`；卡片表面 \`${palette.surface}\`；主文字 \`${palette.textPrimary}\`；次要/辅助文字 \`${palette.textMuted}\`；唯一品牌强调色 \`${palette.accent}\`（仅用于主 CTA、当前激活状态点与焦点环，单屏热点 ≤ 3 处）。`,
    `- **排版方案**：全站 ≤ 2 个字体家族。${headingFontNote}；${bodyFontNote}（${typography.rationale}）。`,
    '- **字号阶梯**：Hero 标题 clamp(2.5rem, 6vw, 4.75rem) / line-height 1.08 / tracking -0.03em；分区标题 24–32px；正文 15–16px / line-height 1.65；辅助小字 ≥12px；中英文混排留出适当空格。',
    `- **间距与形状**：全部间距遵循 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px 倍数；${radiusNote}。`,
    `- **表面层次**：${depthNote}。`,
    '',
    '## Shared Patterns & States',
    `- **动效纪律**：${ds?.motionStyle || def.motionRules}（所有过渡 200–500ms cubic-bezier(0.22,1,0.36,1)，禁止线性动画与阻塞首屏，内置 prefers-reduced-motion 降级）。`,
    '- **表单与按钮状态**：清晰可见的 hover / active / disabled / loading 提交中状态与明确错误提示；移动端点击目标高度 ≥44px；对比度 ≥4.5:1（正文）/ 3:1（大标题）。',
    '- **响应式安全**：<768px 移动端单列排布、导航精简不挤压，顶部导航栏品牌名与菜单项须加 whitespace-nowrap shrink-0（严禁 390px 窄屏折成两行），严禁横向滚动溢出（overflow-x: clip）。',
    '',
    '## Media',
    `- ${ds?.mediaStrategy || def.mediaRule}`
  );

  return lines.join('\n');
}

export function getEmmaDesignGuidePrompt(selectedTheme?: StyleThemeSpec): string {
  const scenarioSummary = (Object.values(DESIGN_SCENARIOS) as DesignScenarioDefinition[])
    .map((s) => `- 场景 ${s.id} (${s.name}): 适用于【${s.keywords}】；调性：${s.toneKeywords}；常规明暗=${s.defaultColorMode}`)
    .join('\n');

  const themeSection = selectedTheme
    ? `
USER PRE-SELECTED STYLE THEME (HIGHEST DESIGN PRIORITY — YOU MUST ALIGN "designSystem" TO THIS THEME):
- Theme Name: ${selectedTheme.name}${selectedTheme.scenario ? ` (Scenario ${selectedTheme.scenario})` : ''}
- Color Mode: ${selectedTheme.colorMode}
- Palette: background=${selectedTheme.palette.background}, surface=${selectedTheme.palette.surface}, textPrimary=${selectedTheme.palette.textPrimary}, textMuted=${selectedTheme.palette.textMuted}, accent=${selectedTheme.palette.accent}
- Typography: headingStyle=${selectedTheme.typography.headingStyle}, bodyStyle=${selectedTheme.typography.bodyStyle}
- Shape/Depth: radiusStyle=${selectedTheme.radiusStyle ?? 'soft'}, surfaceDepth=${selectedTheme.surfaceDepth ?? 'hairline'}
- Style Directive: ${selectedTheme.stylePrompt}
Keep these exact theme palette hex codes and style requirements in designSystem.`
    : '';

  return `
UI DESIGN DECISION FRAMEWORK (from docs/08-ui-design-guide.md):
Before planning pages/collections, classify the product into ONE primary UI Scenario (A–G) and populate "designSystem":
${scenarioSummary}

DESIGN RULES FOR EMMA:
1. NEVER force generic dark-mode SaaS dashboard styling onto lifestyle, craft, coffee/tea, ceramics, ecommerce, or editorial products! Match colorMode, palette hex codes, headingStyle ("editorial-serif" for A/C/D/E narrative & craft brands, "geometric-sans" for B/G SaaS/tech, "minimal-sans" for F mobile), and layoutBlueprint strictly to the user's real business scene.
2. Accent color must be purposeful and refined (<10% of screen); avoid pure #000000 in dark mode (use #0A0A0F–#12141C).
3. Keep layoutBlueprint focused on ONE visual focal point + 40–60% whitespace rhythm + clear section hierarchy (avoid 4 rainbow KPI stat cards on brand/commerce/editorial sites).
4. Set concise Chinese "antiPatterns" (2–4 forbidden traps for this scenario) and "mediaStrategy" (prefer editorial typography + clean bespoke inline SVG geometry/illustrations rather than invented external image URLs).${themeSection}`;
}

export function getAlexDesignGuidePrompt(
  plan: ProductPlan,
  designMd: string,
  styleDirection?: string
): string {
  const scenarioDef = getScenarioDefinition(plan.designSystem?.scenario);

  return `
UI AESTHETIC & CRAFT SYSTEM (STRICTLY ENFORCED FROM docs/08-ui-design-guide.md):
You MUST design and code a gallery-grade, domain-authentic web application — NOT a generic Tailwind admin boilerplate.

CONFLICT PRIORITY ORDER:
1. Engineering correctness & real @atoms/cloud persistence + >=4.5:1 text contrast + mobile usability
2. User theme / custom style directive / Race branch style direction (if specified)
3. Exact project DESIGN.md tokens & matched Scenario ${scenarioDef.id} (${scenarioDef.name}) rules
4. Universal craft precision rules below

ACTIVE PROJECT DESIGN.md (TREAT AS VISUAL CONTRACT AND INCLUDE/PRESERVE "DESIGN.md" IN VFS OR FOLLOW IT EXACTLY):
${designMd}
${styleDirection ? `\nBRANCH / THEME VARIATION TO RENDER:\n${styleDirection}\n` : ''}
SCENARIO ${scenarioDef.id} SPECIFIC CRAFT RULES:
- Layout: ${scenarioDef.layoutRules}
- Color discipline: ${scenarioDef.colorRules}
- Typography: ${scenarioDef.typographyRules}
- Motion: ${scenarioDef.motionRules}
- Media: ${scenarioDef.mediaRule}
- Scenario Anti-Patterns (STRICTLY FORBIDDEN): ${scenarioDef.antiPatterns.join(' | ')}

UNIVERSAL PRECISION & CSS CAPABILITIES IN OUR BUILDER:
1. Layout & Restraint: Keep 40–60% breathing whitespace, generous section spacing (py-16 md:py-24), max-w-6xl container, ONE primary focal point per screen. For brand/commerce/editorial scenarios (A/C/D/E), lead with an asymmetric editorial Hero — NOT 4 dashboard metric boxes at the top!
2. Built-in Fonts: Our builder injects .font-editorial (Source Han Serif SC + Playfair/Georgia serif), .font-display (Inter + PingFang SC/Microsoft YaHei sans), .font-mono (JetBrains Mono), and .tabular-nums. Use them deliberately (<=2 font families total). Give Hero H1 clamp sizing or text-4xl md:text-6xl with tracking-[-0.03em] leading-[1.08].
3. Exact Tokens: Apply the exact DESIGN.md palette hex codes via Tailwind arbitrary values (e.g. bg-[#FAF8F4], text-[#1D1916], border-[rgba(12,12,12,0.08)]) — our builder supports arbitrary rgba(), clamp(), and cubic-bezier() utilities!
4. Zero Broken Images: NEVER write fake external https://images.unsplash.com/... URLs that fail to load. Instead combine refined editorial typography, subtle 1px hairline rules, and 1–2 bespoke minimal inline <svg> illustrations/emblems matching the palette.
5. Pre-Delivery Self-Checklist (Ch. 5):
   - Fonts <=2; tabular-nums on numbers/prices/dates; Chinese/Latin spacing where mixed.
   - Spacing only 4/8px multiples (p-4/6/8, gap-4/6/8, py-12/16/24); <=2 border radius styles.
   - Accent <10% of screen; zero colored text gradients; contrast >=4.5:1.
   - Transitions 200–500ms ease-[cubic-bezier(0.22,1,0.36,1)], never block typing or clicking.
   - Responsive mobile-first (>=44px button/input tap height on mobile, zero horizontal overflow on 390px viewport, and top navbar brand/links MUST use whitespace-nowrap shrink-0 with compact padding/gap so labels never wrap to 2 lines on 390px).`;
}

export function getAlexIterateDesignGuardrail(plan: ProductPlan): string {
  const ds = plan.designSystem;
  const def = getScenarioDefinition(ds?.scenario);
  const palette = ds?.palette ?? def.defaultPalette;

  return `
PRESERVE ESTABLISHED DESIGN SYSTEM (Scenario ${def.id} · ${def.name}):
- Keep background=${palette.background}, surface=${palette.surface}, textPrimary=${palette.textPrimary}, accent=${palette.accent} (<10% rule) unless the user instruction explicitly asks to change colors/theme!
- Preserve existing DESIGN.md in VirtualFS, editorial typography (.font-editorial / .font-display / .tabular-nums), 40–60% breathing whitespace, >=44px mobile touch targets, and forbid introducing generic SaaS clutter or external 404 image URLs.
${ds?.customStylePrompt ? `- Active custom style directive: ${ds.customStylePrompt}` : ''}`;
}
