import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "index",
    "status",
    {
      type: "category",
      label: "제품",
      collapsed: false,
      items: [
        "product/desktop",
        "product/settings",
        "product/characters",
        "product/character-gallery",
        "product/conversation",
        "product/memory-search",
        "product/talk",
        "product/toys",
        "product/music",
        "product/planning",
      ],
    },
    {
      type: "category",
      label: "위젯",
      items: [
        "widgets/overview",
        "widgets/catalog",
        "widgets/installation",
        "widgets/contract",
        "widgets/lifecycle",
        "widgets/authoring",
      ],
    },
    {
      type: "category",
      label: "개발",
      items: [
        "development/architecture",
        "development/nlp",
        "development/talk-reference",
        "development/spicetify",
        "development/talk-coverage",
        "development/roadmap",
        "development/wiki",
        "development/releases",
      ],
    },
    {
      type: "category",
      label: "기준 사양과 검증 기록",
      items: [
        "PRODUCT",
        "VALIDATION-0.2.0",
        "VALIDATION-0.3.0",
        "VALIDATION-WIDGETS",
        "VALIDATION-TALK",
      ],
    },
  ],
};

export default sidebars;
