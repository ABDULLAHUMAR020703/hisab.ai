import { DOMParser } from '@xmldom/xmldom'
import { ExclusiveCanonicalization } from 'xml-crypto'

/**
 * XML canonicalization for ZATCA signing.
 * Simplified C14N-style normalization — modular hook for future full C14N upgrade.
 */
function sortTagAttributes(match: string, tagName: string, rawAttributes: string): string {
  const attributes = [...rawAttributes.matchAll(/([\w:.-]+)="([^"]*)"/g)]
    .map(([, name, value]) => ({ name, value }))
    .sort((a, b) => {
      const aNs = a.name === 'xmlns' || a.name.startsWith('xmlns:')
      const bNs = b.name === 'xmlns' || b.name.startsWith('xmlns:')
      if (aNs !== bNs) return aNs ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  if (attributes.length === 0) return match
  return `<${tagName} ${attributes.map((attr) => `${attr.name}="${attr.value}"`).join(' ')}>`
}

function fallbackCanonicalize(xml: string): string {
  return xml
    .replace(/\r\n/g, '\n')
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/<([A-Za-z_][\w:.-]*)(\s+[^<>]*?)>/g, sortTagAttributes)
    .replace(/>\s+</g, '><')
    .trim()
}

export function canonicalizeInvoiceXml(xml: string): string {
  const withoutDeclaration = xml
    .replace(/\r\n/g, '\n')
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .trim()

  try {
    const document = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: (message) => { throw new Error(String(message)) },
        fatalError: (message) => { throw new Error(String(message)) },
      },
    }).parseFromString(withoutDeclaration, 'application/xml')
    return new ExclusiveCanonicalization().process(document.documentElement, {
      inclusiveNamespacesPrefixList: ['cac', 'cbc', 'ext'],
    })
  } catch {
    return fallbackCanonicalize(withoutDeclaration)
  }
}

export function stripSignatureBlock(xml: string): string {
  return xml.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/g, '').trim()
}
