import { promises as fs } from 'fs';
import * as path from 'path';
import sharp from 'sharp';

/** 归一化 bbox：[x0,y0,x1,y1]，坐标范围 0-1 */
export type BBox = [number, number, number, number];

const RASTER_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff']);

/** 是否为可用 sharp 直接裁切的光栅图片（PDF 无法单页裁切，需走回退） */
export function isRasterImage(imagePath: string): boolean {
  return RASTER_EXT.has(path.extname(imagePath).toLowerCase());
}

export function isPdf(imagePath: string): boolean {
  return path.extname(imagePath).toLowerCase() === '.pdf';
}

/**
 * 按归一化 bbox 把整页图裁出单题，输出 PNG 到 outPath。
 * 坐标超出 [0,1] 会被钳制到图片实际边界，保证可裁切。
 */
export async function cropImageByBbox(srcPath: string, bbox: BBox, outPath: string): Promise<void> {
  const meta = await sharp(srcPath, { limitInputPixels: false }).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error('无法读取图片尺寸，无法裁切');

  const [x0, y0, x1, y1] = bbox;
  const left = Math.max(0, Math.min(w, Math.round(Math.min(x0, x1) * w)));
  const top = Math.max(0, Math.min(h, Math.round(Math.min(y0, y1) * h)));
  const right = Math.max(0, Math.min(w, Math.round(Math.max(x0, x1) * w)));
  const bottom = Math.max(0, Math.min(h, Math.round(Math.max(y0, y1) * h)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(srcPath, { limitInputPixels: false })
    .extract({ left, top, width, height })
    .png()
    .toFile(outPath);
}
