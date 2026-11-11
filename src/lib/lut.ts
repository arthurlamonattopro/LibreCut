import type { LutSettings } from "./types";

export interface ParsedLut {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: number[];
  cubeText: string;
}

/** Parses the supported .cube subset (3D LUTs with optional title/domain). */
export function parseCubeLut(text: string): ParsedLut {
  if (text.length > 16 * 1024 * 1024) throw new Error("This .cube file is too large (maximum 16 MB).");
  let title = "Imported LUT";
  let size: number | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let sawMin = false;
  let sawMax = false;
  const data: number[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const titleMatch = /^TITLE\s+"(.*)"\s*$/i.exec(line);
    if (titleMatch) { title = titleMatch[1].trim() || title; continue; }
    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)\s*$/i.exec(line);
    if (sizeMatch) {
      if (size !== undefined) throw new Error("The .cube file declares LUT_3D_SIZE more than once.");
      size = Number(sizeMatch[1]);
      if (size < 2 || size > 64) throw new Error("Supported 3D LUT sizes are 2 through 64.");
      continue;
    }
    const domainMatch = /^(DOMAIN_MIN|DOMAIN_MAX)\s+(.+)$/i.exec(line);
    if (domainMatch) {
      const values = domainMatch[2].trim().split(/\s+/).map(Number);
      if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) throw new Error(`Invalid ${domainMatch[1]} on line ${index + 1}.`);
      if (domainMatch[1].toUpperCase() === "DOMAIN_MIN") { if (sawMin) throw new Error("Duplicate DOMAIN_MIN."); domainMin = values as [number, number, number]; sawMin = true; }
      else { if (sawMax) throw new Error("Duplicate DOMAIN_MAX."); domainMax = values as [number, number, number]; sawMax = true; }
      continue;
    }
    if (/^(LUT_1D_SIZE|1D_)/i.test(line)) throw new Error("1D LUTs are not supported. Import a .cube file with LUT_3D_SIZE.");
    if (/^[A-Z_]+\b/i.test(line)) throw new Error(`Unsupported .cube directive on line ${index + 1}.`);
    const values = line.split(/\s+/).map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) throw new Error(`Invalid RGB sample on line ${index + 1}.`);
    data.push(...values);
  }
  if (size === undefined) throw new Error("The .cube file is missing LUT_3D_SIZE.");
  if (domainMin.some((value, i) => value >= domainMax[i])) throw new Error("Each DOMAIN_MIN value must be lower than DOMAIN_MAX.");
  if (data.length !== size ** 3 * 3) throw new Error(`Expected ${size ** 3} RGB samples for a ${size}³ LUT, found ${data.length / 3}.`);
  return { title, size, domainMin, domainMax, data, cubeText: text };
}

export function lutSettingsFromCube(lut: ParsedLut): LutSettings {
  return { title: lut.title, size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax, data: lut.data, cubeText: lut.cubeText, strength: 1 } as LutSettings;
}
