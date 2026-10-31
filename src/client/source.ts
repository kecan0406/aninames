import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { USER_AGENT } from '../model.ts'
import { manifestPaths, parsePath, readManifest, TABLES } from './format.ts'

export interface Source {
  manifest(signal?: AbortSignal): Promise<string>
  file(path: string, signal?: AbortSignal): Promise<Uint8Array>
}

export class Missing extends Error {}

interface Fresh {
  text: string
  etag: string | null
  modified: string | null
}

interface Validators {
  etag: string | null
  modified: string | null
}

type Revalidate = (validators: Validators, signal?: AbortSignal) => Promise<Fresh | undefined>

const revalidators = new WeakMap<Source, Revalidate>()

function checked(path: string): string {
  if (!parsePath(path)) throw new Error(`aninames: ${JSON.stringify(path)} is not a chunk file name`)
  return path
}

export function httpSource(
  base: string,
  options: { fetch?: typeof fetch; headers?: Record<string, string> } = {},
): Source {
  const root = base.endsWith('/') ? base : `${base}/`
  const request = async (path: string, signal: AbortSignal | undefined, extra: Record<string, string> = {}) => {
    const url = new URL(path, root)
    const response = await (options.fetch ?? fetch)(url, {
      headers: { 'user-agent': USER_AGENT, ...options.headers, ...extra },
      ...(signal ? { signal } : {}),
    })
    if (response.status === 404) throw new Missing(`aninames: ${url} is not there (404)`)
    if (!response.ok && response.status !== 304) throw new Error(`aninames: ${url} answered ${response.status}`)
    return response
  }
  const source: Source = {
    manifest: async (signal) => (await request('manifest.json', signal)).text(),
    file: async (path, signal) => new Uint8Array(await (await request(checked(path), signal)).arrayBuffer()),
  }
  revalidators.set(source, async ({ etag, modified }, signal) => {
    const response = await request('manifest.json', signal, {
      ...(etag ? { 'if-none-match': etag } : {}),
      ...(modified ? { 'if-modified-since': modified } : {}),
    })
    if (response.status === 304) return undefined
    return {
      text: await response.text(),
      etag: response.headers.get('etag'),
      modified: response.headers.get('last-modified'),
    }
  })
  return source
}

const missing = (error: unknown) => (error as { code?: unknown } | null)?.code === 'ENOENT'

export function fileSource(dir: string): Source {
  return {
    async manifest(signal) {
      try {
        return await readFile(join(dir, 'manifest.json'), { encoding: 'utf8', ...(signal ? { signal } : {}) })
      } catch (error) {
        if (missing(error)) throw new Error(`aninames: ${join(dir, 'manifest.json')} is missing; run mise run chunk`)
        throw error
      }
    },
    async file(path, signal) {
      try {
        return new Uint8Array(await readFile(join(dir, checked(path)), signal ? { signal } : {}))
      } catch (error) {
        if (missing(error)) throw new Missing(`aninames: ${join(dir, path)} is missing`)
        throw error
      }
    },
  }
}

interface Cached extends Validators {
  text: string
  checked: number
}

function cachedOf(value: unknown): Cached | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { text, etag, modified, checked } = value as Record<string, unknown>
  if (typeof text !== 'string' || typeof checked !== 'number') return undefined
  return {
    text,
    checked,
    etag: typeof etag === 'string' ? etag : null,
    modified: typeof modified === 'string' ? modified : null,
  }
}

async function put(path: string, data: string | Uint8Array): Promise<void> {
  const part = `${path}.${randomUUID()}.part`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(part, data)
    await rename(part, path)
  } catch {
    await rm(part, { force: true })
  }
}

async function prune(dir: string, text: string): Promise<void> {
  const named = manifestPaths(readManifest(text))
  for (const layer of await readdir(dir).catch(() => [])) {
    for (const table of TABLES) {
      const folder = join(dir, layer, table)
      for (const file of await readdir(folder).catch(() => [])) {
        const path = `${layer}/${table}/${file}`
        if (parsePath(path) && !named.has(path)) await rm(join(folder, file), { force: true })
      }
    }
  }
}

export function cachedSource(source: Source, dir: string, options: { maxAge?: number } = {}): Source {
  const maxAge = options.maxAge ?? 86_400_000
  const state = join(dir, 'manifest.cache.json')
  let stale = false
  const read = async (): Promise<Cached | undefined> => {
    try {
      return cachedOf(JSON.parse(await readFile(state, 'utf8')))
    } catch {
      return undefined
    }
  }
  const fetchFresh = async (cached: Cached | undefined, signal?: AbortSignal): Promise<Fresh | undefined> => {
    const revalidate = revalidators.get(source)
    if (revalidate) return revalidate(cached ?? { etag: null, modified: null }, signal)
    return { text: await source.manifest(signal), etag: null, modified: null }
  }
  return {
    async manifest(signal) {
      const cached = await read()
      if (cached && !stale && Date.now() - cached.checked < maxAge) return cached.text
      let fresh: Fresh | undefined
      try {
        fresh = await fetchFresh(cached, signal)
      } catch (error) {
        if (cached && !signal?.aborted) return cached.text
        throw error
      }
      stale = false
      if (!fresh) {
        if (!cached) throw new Error('aninames: the server answered 304 to a manifest request without validators')
        await put(state, JSON.stringify({ ...cached, checked: Date.now() }))
        return cached.text
      }
      readManifest(fresh.text)
      await put(state, JSON.stringify({ ...fresh, checked: Date.now() }))
      if (fresh.text !== cached?.text) await prune(dir, fresh.text)
      return fresh.text
    },
    async file(path, signal) {
      const target = join(dir, checked(path))
      try {
        return new Uint8Array(await readFile(target))
      } catch (error) {
        if (!missing(error)) throw error
      }
      let bytes: Uint8Array
      try {
        bytes = await source.file(path, signal)
      } catch (error) {
        if (error instanceof Missing) stale = true
        throw error
      }
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (!hash.startsWith(parsePath(path)?.hash ?? '-')) {
        throw new Error(`aninames: ${path} arrived with other contents (sha256 ${hash.slice(0, 12)})`)
      }
      await put(target, bytes)
      return bytes
    },
  }
}
