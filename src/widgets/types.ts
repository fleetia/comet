export type WidgetCatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  required: string[];
  connection: string | null;
};

export type WidgetValue =
  | null
  | boolean
  | number
  | string
  | WidgetValue[]
  | { [key: string]: WidgetValue };

export type WidgetView = {
  id: string;
  kind: string;
  version: number;
  installed: boolean;
  enabled: boolean;
  revision: number;
  data: WidgetValue;
  error: string | null;
  status: "not-installed" | "install-error" | "disabled" | "setup" | "error" | "enabled";
  missing: string[];
  packageBytes: number;
  backgroundUpdatedAt?: number | null;
};

export type WidgetSnapshot = {
  catalog: WidgetCatalogEntry[];
  widgets: WidgetView[];
  onboardingDone: boolean;
};
