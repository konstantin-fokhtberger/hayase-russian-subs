import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const bundle = await readFile(resolve(root, 'src/extension.js'))
await mkdir(dist, { recursive: true })
await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
await writeFile(resolve(dist, 'hayase-russian-subs.js'), bundle)
await writeFile(resolve(dist, `hayase-russian-subs-${packageJson.version}.js`), bundle)
