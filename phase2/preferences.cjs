const fs = require('node:fs')
const path = require('node:path')

function recentProjectName(projectPath, name) {
  const supplied = typeof name === 'string' ? name.trim() : ''
  return supplied && !['Untitled track', 'Untitled project'].includes(supplied)
    ? supplied : path.basename(projectPath, path.extname(projectPath))
}

function normalizeRecentProjects(list) {
  if (!Array.isArray(list)) return []
  const result = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.path !== 'string' || !item.path.trim()) continue
    const safePath = path.resolve(item.path.trim())
    const name = recentProjectName(safePath, item.name)
    const lastOpened = typeof item.lastOpened === 'number' && Number.isFinite(item.lastOpened) ? item.lastOpened : Date.now()
    result.push({ path: safePath, name, lastOpened })
    if (result.length >= 10) break
  }
  return result
}

function readPreferences(userData) {
  const target = path.join(userData, 'workflow-preferences.json')
  try {
    if (fs.statSync(target).size > 16384) throw new Error('Preferences file is too large')
    const stored = JSON.parse(fs.readFileSync(target, 'utf8'))
    return {
      exportPreset: ['720p', '1080p'].includes(stored.exportPreset) ? stored.exportPreset : '1080p',
      lastTemplateId: typeof stored.lastTemplateId === 'string' && stored.lastTemplateId.length <= 128
        ? stored.lastTemplateId : '',
      recentProjects: normalizeRecentProjects(stored.recentProjects),
    }
  } catch {
    return { exportPreset: '1080p', lastTemplateId: '', recentProjects: [] }
  }
}

function writePreferences(userData, update) {
  const current = readPreferences(userData)
  const next = { ...current, ...update }
  if (!['720p', '1080p'].includes(next.exportPreset)) throw new Error('Unsupported export preset')
  if (typeof next.lastTemplateId !== 'string' || next.lastTemplateId.length > 128) throw new Error('Invalid template choice')
  if (next.recentProjects !== undefined) {
    next.recentProjects = normalizeRecentProjects(next.recentProjects)
  }
  fs.mkdirSync(userData, { recursive: true })
  const target = path.join(userData, 'workflow-preferences.json')
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(temporary, target)
  return next
}

// Unavailable drives may return later, so hide missing files without forgetting
// their saved entries. Permission errors do not prove that a file was deleted.
function isMissingProject(projectPath) {
  try { return !fs.statSync(projectPath).isFile() }
  catch (error) { return ['ENOENT', 'ENOTDIR'].includes(error.code) }
}

function availableRecentProjects(userData) {
  return readPreferences(userData).recentProjects.filter(item => !isMissingProject(item.path))
}

function recordRecentProject(userData, projectPath, projectName = '') {
  const current = readPreferences(userData)
  const resolved = path.resolve(projectPath)
  const name = recentProjectName(resolved, projectName)
  const filtered = current.recentProjects.filter(p => path.resolve(p.path) !== resolved)
  filtered.unshift({ path: resolved, name, lastOpened: Date.now() })
  return writePreferences(userData, { recentProjects: filtered.slice(0, 10) })
}

module.exports = { readPreferences, writePreferences, recordRecentProject, normalizeRecentProjects, availableRecentProjects, isMissingProject }
