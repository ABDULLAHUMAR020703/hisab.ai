import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  output: 'standalone',
  // PDFKit loads standard fonts via fs.readFileSync(__dirname + '/data/*.afm').
  // Bundling pdfkit breaks __dirname, causing ENOENT for Helvetica.afm in API routes.
  serverExternalPackages: ['pdfkit', 'sharp'],
  // Ensure AFM/ICC assets ship with the serverless function on Vercel.
  outputFileTracingIncludes: {
    '/api/invoices/[id]/pdf': ['./node_modules/pdfkit/js/data/**/*'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
