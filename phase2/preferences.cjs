const fs = require('node:fs')
const path = require('node:path')

function readPreferences(userData) {
  const target = path.join(userData, 'workflow-preferences.json')
  try {
    if (fs.statSync(target).size > 4096) throw new Error('Preferences file is too large')
    const stored = JSON.parse(fs.readFileSync(target, 'utf8'))
    return { exportPreset: ['720p', '1080p'].includes(stored.exportPreset) ? stored.exportPreset : '1080p',
      lastTemplateId: typeof stored.lastTemplateId === 'string' && stored.lastTemplateId.length <= 128
        ? stored.lastTemplateId : '' }
  } catch { return { exportPreset: '1080p', lastTemplateId: '' } }
}

function writePreferences(userData, update) {
  const next = { ...readPreferences(userData), ...update }
  if (!['720p', '1080p'].includes(next.exportPreset)) throw new Error('Unsupported export preset')
  if (typeof next.lastTemplateId !== 'string' || next.lastTemplateId.length > 128) throw new Error('Invalid template choice')
  fs.mkdirSync(userData, { recursive: true })
  const target = path.join(userData, 'workflow-preferences.json')
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(temporary, target)
  return next
}

module.exports = { readPreferences, writePreferences }
