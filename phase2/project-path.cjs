const path = require('node:path')

function projectSaveName(title) {
  if (typeof title !== 'string') throw new Error('Invalid project title')
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 200)
    .replace(/\.json$/i, '').replace(/[. ]+$/g, '')
  if (!name) name = 'Untitled project'
  // Windows reserves these names even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name
  return name + '.json'
}

function encapsulateProjectPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw new Error('Invalid target path')
  const ext = path.extname(targetPath).toLowerCase()
  const resolved = path.resolve(targetPath.trim() + (ext !== '.json' ? '.json' : ''))
  const projectName = path.parse(resolved).name
  const parentDir = path.dirname(resolved)
  if (path.basename(parentDir).toLowerCase() === projectName.toLowerCase()) {
    return path.join(parentDir, `${projectName}.json`)
  }
  return path.join(parentDir, projectName, `${projectName}.json`)
}

module.exports = { encapsulateProjectPath, projectSaveName }
