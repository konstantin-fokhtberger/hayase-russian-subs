import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'dist')
const host = '127.0.0.1'
const port = 8788
const types = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${host}`).pathname
  const filename = pathname === '/' ? 'manifest.json' : pathname.slice(1)
  const target = resolve(root, normalize(filename))
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  // Hayase's UI is served from https://hayase.app. Chromium treats its request
  // to 127.0.0.1 as Private Network Access and otherwise rejects it before JSON parsing.
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (request.method === 'OPTIONS') return response.writeHead(204).end()
  if (request.method !== 'GET' || !(target === root || target.startsWith(root + sep))) return response.writeHead(404).end()
  try {
    if (!(await stat(target)).isFile()) throw new Error('not a file')
    await access(target)
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' })
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404).end()
  }
})

server.listen(port, host, () => {
  console.log(`Hayase development repository: http://${host}:${port}/manifest.json`)
})
