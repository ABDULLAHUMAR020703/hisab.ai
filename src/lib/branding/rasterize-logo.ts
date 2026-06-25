import 'server-only'
import sharp from 'sharp'
import { isSvgMime } from './validate-logo-file'

/**
 * Normalizes uploaded logos to PNG for storage and PDF embedding.
 * SVG is rasterized; raster formats are re-encoded as PNG for consistency.
 */
export async function rasterizeCompanyLogoToPng(
  buffer: Buffer,
  mime: string,
): Promise<Buffer> {
  if (mime === 'image/png') {
    return buffer
  }

  if (isSvgMime(mime)) {
    return sharp(buffer, { density: 300 }).png({ compressionLevel: 9, force: true }).toBuffer()
  }

  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return sharp(buffer).png({ compressionLevel: 9, force: true }).toBuffer()
  }

  return sharp(buffer).png({ compressionLevel: 9, force: true }).toBuffer()
}
