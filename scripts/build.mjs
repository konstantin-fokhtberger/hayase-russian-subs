import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
await writeFile(resolve(dist, 'hayase-russian-subs.js'), await readFile(resolve(root, 'src/extension.js')))
