export interface DesignColor {
  role: "text" | "background" | "border";
  value: string;
  count: number;
  weight: number;
  examples: string[];
}

export interface DesignTextRun {
  size: number;
  weight: number;
  family: string;
  code: boolean;
  chars: number;
  color: string | null;
}

export interface DesignSample {
  scheme: "light" | "dark";
  colors: DesignColor[];
  text: DesignTextRun[];
  surfaces: Array<{ color: string; count: number }>;
  spacing: number[];
  skipped: Array<{ target: string; reason: string }>;
}

export function collectDesign(): DesignSample {
  return { scheme: "light", colors: [], text: [], surfaces: [], spacing: [], skipped: [] };
}
