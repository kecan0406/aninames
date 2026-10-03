import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export const USER_AGENT = 'aninames/0.0 (+https://github.com/kecan0406/aninames)'

export async function download(url: string, path: string, headers: Record<string, string> = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } })
  if (!res.ok || !res.body) {
    throw new Error(`aninames: ${url} answered ${res.status}`)
  }
  const part = `${path}.part`
  const sink = Bun.file(part).writer()
  for await (const chunk of res.body) sink.write(chunk)
  await sink.end()
  await rename(part, path)
}

export async function fresh(path: string, days: number): Promise<boolean> {
  const info = await stat(path).catch(() => undefined)
  return info !== undefined && Date.now() - info.mtimeMs < days * 86_400_000
}

export async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } })
  if (!res.ok) {
    throw new Error(`aninames: ${url} answered ${res.status}`)
  }
  return (await res.json()) as T
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}
