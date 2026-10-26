const fs = require('node:fs')
const path = require('node:path')

function normalizeRecentProjects(list) {
  if (!Array.isArray(list)) return []
  const result = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.path !== 'string' || !item.path.trim()) continue
    const safePath = path.resolve(item.path.trim())
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : path.basename(safePath, '.json')
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

function recordRecentProject(userData, projectPath, projectName = '') {
  const current = readPreferences(userData)
  const resolved = path.resolve(projectPath)
  const name = projectName && projectName !== 'Untitled track' ? projectName : path.basename(resolved, '.json')
  const filtered = current.recentProjects.filter(p => path.resolve(p.path) !== resolved)
  filtered.unshift({ path: resolved, name, lastOpened: Date.now() })
  return writePreferences(userData, { recentProjects: filtered.slice(0, 10) })
}

module.exports = { readPreferences, writePreferences, recordRecentProject, normalizeRecentProjects }
