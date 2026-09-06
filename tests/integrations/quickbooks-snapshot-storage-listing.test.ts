import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)
requireModule('../../scripts/zatca/setup-server-only.cjs')

const { collectObjectPaths, isStorageFolder } = requireModule(
  '../../src/lib/import-export/quickbooks/snapshot/snapshot-storage',
) as typeof import('../../src/lib/import-export/quickbooks/snapshot/snapshot-storage')

type Entry = { name: string; id?: string | null; metadata?: Record<string, unknown> | null }

/** Builds a paginated list fn from a { fullPath -> rows } tree, like Supabase Storage. */
function fakeTree(tree: Record<string, Entry[]>) {
  return async (fullPath: string, offset: number): Promise<Entry[]> => {
    const rows = tree[fullPath] ?? []
    return rows.slice(offset, offset + 100)
  }
}

const PREFIX = 'c1/quickbooks/r1/snapshots/s1'
const folder = (name: string): Entry => ({ name, id: null, metadata: null })
const file = (name: string, size = 10): Entry => ({ name, id: `obj-${name}`, metadata: { size } })

test('folder detection: null id + null metadata is a folder; an object row is not', () => {
  assert.equal(isStorageFolder(folder('invoices')), true)
  assert.equal(isStorageFolder({ name: 'x' }), true) // id + metadata both absent
  assert.equal(isStorageFolder(file('page-000001.json')), false)
})

test('discovers every page object across nested folders', async () => {
  const tree: Record<string, Entry[]> = {
    [PREFIX]: [folder('accounts'), folder('invoices'), folder('attachments'), file('manifest.json')],
    [`${PREFIX}/accounts`]: [file('page-000001.json')],
    [`${PREFIX}/invoices`]: [file('page-000001.json'), file('page-000002.json')],
    [`${PREFIX}/attachments`]: [folder('att-1'), file('index.json')],
    [`${PREFIX}/attachments/att-1`]: [file('receipt.pdf')],
  }
  const paths = await collectObjectPaths(PREFIX, fakeTree(tree))
  assert.deepEqual(paths.sort(), [
    'accounts/page-000001.json',
    'attachments/att-1/receipt.pdf',
    'attachments/index.json',
    'invoices/page-000001.json',
    'invoices/page-000002.json',
    'manifest.json',
  ])
})

test('an empty folder contributes nothing and is never treated as a file', async () => {
  const tree: Record<string, Entry[]> = {
    [PREFIX]: [folder('accounts'), folder('invoices')],
    [`${PREFIX}/accounts`]: [file('page-000001.json')],
    [`${PREFIX}/invoices`]: [], // resource folder exists but extraction wrote nothing
  }
  const paths = await collectObjectPaths(PREFIX, fakeTree(tree))
  assert.deepEqual(paths, ['accounts/page-000001.json'])
  assert.ok(!paths.some((p) => p === 'invoices' || p.startsWith('invoices/')))
})

test('a missing folder (no listing entry at all) yields nothing', async () => {
  const tree: Record<string, Entry[]> = {
    [PREFIX]: [folder('accounts')],
    [`${PREFIX}/accounts`]: [file('page-000001.json')],
  }
  const paths = await collectObjectPaths(PREFIX, fakeTree(tree))
  assert.deepEqual(paths, ['accounts/page-000001.json'])
})

test('the Supabase empty-folder placeholder is ignored', async () => {
  const tree: Record<string, Entry[]> = {
    [PREFIX]: [folder('invoices')],
    [`${PREFIX}/invoices`]: [{ name: '.emptyFolderPlaceholder', id: 'ph', metadata: { size: 0 } }],
  }
  const paths = await collectObjectPaths(PREFIX, fakeTree(tree))
  assert.deepEqual(paths, [])
})

test('pagination across >100 entries in one folder is followed', async () => {
  const many = Array.from({ length: 250 }, (_, i) => file(`page-${String(i + 1).padStart(6, '0')}.json`))
  const tree: Record<string, Entry[]> = {
    [PREFIX]: [folder('invoices')],
    [`${PREFIX}/invoices`]: many,
  }
  const paths = await collectObjectPaths(PREFIX, fakeTree(tree))
  assert.equal(paths.length, 250)
  assert.ok(paths.includes('invoices/page-000123.json'))
})
