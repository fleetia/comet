import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      },
    },
  },
  stories: ["../stories/**/*.mdx", "../stories/**/*.stories.tsx"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-docs"],
  docs: { defaultName: "사용 안내" },
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      tsconfigPath: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
      include: [
        fileURLToPath(new URL("../../ui/src/**/*.tsx", import.meta.url)),
        fileURLToPath(new URL("../../icon/src/**/*.tsx", import.meta.url)),
      ],
    },
  },
};

export default config;
