const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { readPreferences, recordRecentProject, availableRecentProjects, isMissingProject } = require('../preferences.cjs')
const root = path.resolve(__dirname, '../../artifacts/phase2/recent-projects-' + randomUUID())
fs.mkdirSync(root, { recursive: true })

test('missing projects are hidden without deleting preferences and reappear if restored', () => {
  const profile = path.join(root, 'profile'), project = path.join(root, 'Example.json')
  fs.writeFileSync(project, '{}'); recordRecentProject(profile, project, 'Example')
  assert.equal(availableRecentProjects(profile).length, 1)
  fs.renameSync(project, project + '.moved')
  assert.deepEqual(availableRecentProjects(profile), [])
  assert.equal(readPreferences(profile).recentProjects[0].path, project)
  fs.renameSync(project + '.moved', project)
  assert.equal(availableRecentProjects(profile)[0].path, project)
})

test('directories and missing parent components cannot act as projects', () => {
  assert.equal(isMissingProject(root), true)
  assert.equal(isMissingProject(path.join(root, 'deleted', 'project.json')), true)
  const file = path.join(root, 'file'); fs.writeFileSync(file, '')
  assert.equal(isMissingProject(path.join(file, 'project.json')), true)
})

test('permission failures keep a recent entry instead of treating it as deleted', () => {
  const stat = fs.statSync
  fs.statSync = () => { throw Object.assign(new Error('Access denied'), { code: 'EACCES' }) }
  try { assert.equal(isMissingProject(path.join(root, 'unknown.json')), false) }
  finally { fs.statSync = stat }
})
