import type { MotionOverride } from "../../types";
import type { WidgetValue } from "../types";

export type WidgetDefinition = {
  name: string;
  description: string;
  source: string;
  initialState: WidgetValue;
};
export type GeneratedWidget = {
  id: string;
  definition: WidgetDefinition;
  state: WidgetValue;
  revision: number;
  installed: boolean;
  enabled: boolean;
  status: "draft" | "ready" | "error";
  error: string | null;
  installation: {
    origin: "manual" | "automatic" | "import";
    model: string | null;
    installedAt: number;
  } | null;
  updatedAt: number | null;
};
export type GenerationEligibility = {
  allowed: boolean;
  reason: string;
  model: string;
  parameterBillions: number | null;
  source: "catalog" | "gguf" | "api-name" | "unknown";
};
export type Workshop = {
  widgets: GeneratedWidget[];
  automatic: boolean;
  runtime: string;
  generationEligibility: GenerationEligibility;
};
export type StateRule = {
  id: string;
  widgetId: string;
  characterId: string;
  field: string;
  operator: string;
  value: WidgetValue;
  text: string;
  expression: string | null;
  motion: MotionOverride | null;
  cooldownMs: number;
  enabled: boolean;
};
