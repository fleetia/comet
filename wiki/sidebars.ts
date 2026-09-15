import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'index',
    'status',
    {
      type: 'category',
      label: '제품',
      collapsed: false,
      items: ['product/desktop', 'product/characters', 'product/conversation', 'product/toys', 'product/planning'],
    },
    {
      type: 'category',
      label: '위젯',
      items: [
        'widgets/overview',
        'widgets/catalog',
        'widgets/installation',
        'widgets/contract',
        'widgets/lifecycle',
        'widgets/authoring',
      ],
    },
    {
      type: 'category',
      label: '개발',
      items: ['development/architecture', 'development/roadmap', 'development/wiki'],
    },
    {
      type: 'category',
      label: '기준 사양과 검증 기록',
      items: ['PRODUCT', 'VALIDATION-0.2.0', 'VALIDATION-0.3.0'],
    },
  ],
};

export default sidebars;
