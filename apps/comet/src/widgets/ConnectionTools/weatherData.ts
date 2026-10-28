import { record, text, type DataRecord } from "../toolData";

export type WeatherConfig = {
  name: string;
  latitude: number;
  longitude: number;
  temperatureUnit: "celsius" | "fahrenheit";
  showApparent: boolean;
  showDetails: boolean;
  showTomorrow: boolean;
  allowTalk: boolean;
  refreshIntervalMinutes: number;
};

export function weatherConfig(data: DataRecord): WeatherConfig {
  const config = record(data.config);
  return {
    name: text(config.name),
    latitude: typeof config.latitude === "number" ? config.latitude : 0,
    longitude: typeof config.longitude === "number" ? config.longitude : 0,
    temperatureUnit: config.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    showApparent: config.showApparent !== false,
    showDetails: config.showDetails === true,
    showTomorrow: config.showTomorrow !== false,
    allowTalk: config.allowTalk !== false,
    refreshIntervalMinutes:
      typeof config.refreshIntervalMinutes === "number" ? config.refreshIntervalMinutes : 30,
  };
}

export function weatherTemperature(
  value: unknown,
  config: Pick<WeatherConfig, "temperatureUnit">,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const fahrenheit = config.temperatureUnit === "fahrenheit";
  return `${Math.round((fahrenheit ? (value * 9) / 5 + 32 : value) * 10) / 10}°${fahrenheit ? "F" : "C"}`;
}

export function weatherCondition(code: unknown): string {
  if (typeof code !== "number") return "상태 확인 불가";
  if (code === 0) return "맑음";
  if (code <= 2) return "구름 조금";
  if (code <= 3) return "흐림";
  if (code <= 48) return "안개";
  if (code <= 67) return "비";
  if (code <= 77) return "눈";
  if (code <= 82) return "소나기";
  if (code <= 86) return "눈 소나기";
  return "뇌우";
}

