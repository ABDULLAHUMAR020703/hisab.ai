import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PDFKit loads standard fonts via fs.readFileSync(__dirname + '/data/*.afm').
  // Bundling pdfkit breaks __dirname, causing ENOENT for Helvetica.afm in API routes.
  serverExternalPackages: ['pdfkit', 'sharp'],
  // Ensure AFM/ICC assets ship with the serverless function on Vercel.
  outputFileTracingIncludes: {
    '/api/invoices/[id]/pdf': ['./node_modules/pdfkit/js/data/**/*'],
  },
}

export default nextConfig
