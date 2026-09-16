import path from 'node:path';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { downloadFile } from './documents';
import { rasterizePdfPage } from '../extract/rasterize';

export const renderPdfPageInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z.string().describe('The file ID of a PDF (drawing exports included).'),
  page: z.number().int().min(1).optional().describe('1-based page to render (default 1).'),
  scale: z
    .number()
    .min(0.5)
    .max(4)
    .optional()
    .describe(
      'Zoom relative to the PDF\'s own points, where 1 = 72 dpi (default 2). Capped, and reduced further for very ' +
        'large sheets, to keep the rendered image a reasonable size.',
    ),
});
export type RenderPdfPageInput = z.infer<typeof renderPdfPageInput>;

/**
 * Rasterizes one PDF page to an image so the chat can look at it directly —
 * symbols, dimension lines, hatching and other linework that a text search
 * over the same drawing (search_file_content) cannot see, because none of it
 * is real text. Call this only when the text layer isn't enough; it costs
 * image tokens that a text search does not.
 */
export async function renderPdfPage(client: DaluxClient, args: RenderPdfPageInput) {
  const download = await downloadFile(client, args);
  if (!download.found || !download.filePath) {
    return { found: false, message: 'message' in download ? download.message : 'File not found.' };
  }

  const fileName = (download.fileName as string | null) ?? '';
  if (path.extname(fileName).toLowerCase() !== '.pdf') {
    return {
      found: true,
      rendered: false,
      fileId: args.fileId,
      fileName: download.fileName,
      message:
        `render_pdf_page only rasterizes PDFs; "${fileName || 'this file'}" is not one. ` +
        `The file is downloaded at ${download.filePath} if another tool can read it.`,
    };
  }

  const page = args.page ?? 1;
  try {
    const rendered = await rasterizePdfPage(download.filePath as string, page, args.scale ?? 2);
    return {
      found: true,
      rendered: true,
      fileId: args.fileId,
      fileName: download.fileName,
      page,
      pageCount: rendered.pageCount,
      width: rendered.width,
      height: rendered.height,
      image: { mimeType: 'image/png' as const, data: rendered.png.toString('base64') },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { found: true, rendered: false, fileId: args.fileId, fileName: download.fileName, page, message };
  }
}
