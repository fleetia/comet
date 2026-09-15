import type { Config } from '@docusaurus/types';
import type { Options, ThemeConfig } from '@docusaurus/preset-classic';
import type { PluginOptions } from '@easyops-cn/docusaurus-search-local';

const config: Config = {
  title: 'Comet 위키',
  tagline: '바탕화면 동행과 위젯의 사양·설계·개발 기록',
  url: 'http://127.0.0.1:3000',
  baseUrl: '/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'ko', locales: ['ko'] },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        blog: false,
        pages: false,
      } satisfies Options,
    ],
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['ko', 'en'],
        docsDir: '../docs',
        docsRouteBasePath: '/',
        indexBlog: false,
        indexPages: false,
        highlightSearchTermsOnTargetPage: true,
      } satisfies PluginOptions,
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'Comet 위키',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: '문서' },
        { to: '/status', label: '현재 상태', position: 'right' },
      ],
    },
    docs: { sidebar: { hideable: true, autoCollapseCategories: true } },
    colorMode: { respectPrefersColorScheme: true },
  } satisfies ThemeConfig,
};

export default config;
