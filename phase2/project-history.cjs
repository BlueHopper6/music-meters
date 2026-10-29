// Session-only snapshots; seeking is not an edit. Groups keep continuous
// text/color/drag gestures to one undo step.
// Transport position belongs to the live session, never to edit history.
const snapshot = project => JSON.stringify({ ...project, previewFrame: 0 })
class ProjectHistory {
  constructor(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid history limit')
    this.limit = limit
    this.entries = []
    this.index = -1
    this.group = ''
  }
  reset(project) {
    this.entries = [snapshot(project)]
    this.index = 0
    this.endGroup()
  }
  endGroup() { this.group = '' }
  replaceCurrent(project) {
    if (this.index >= 0) this.entries[this.index] = snapshot(project)
    this.endGroup()
  }
  get canUndo() { return this.index > 0 }
  get canRedo() { return this.index >= 0 && this.index < this.entries.length - 1 }
  record(project, group = '') {
    if (this.index < 0) return
    const serialized = snapshot(project)
    if (this.entries[this.index] === serialized) return
    this.entries.splice(this.index + 1)
    if (group && this.group === group && this.index > 0) this.entries[this.index] = serialized
    else { this.entries.push(serialized); this.index++ }
    this.group = group
    if (this.entries.length > this.limit + 1) { this.entries.shift(); this.index-- }
  }
  peek(direction) {
    if (direction !== -1 && direction !== 1) throw new Error('Invalid history direction')
    if (direction === -1 ? !this.canUndo : !this.canRedo) return null
    return JSON.parse(this.entries[this.index + direction])
  }
  move(direction) {
    const next = this.peek(direction)
    if (next) { this.index += direction; this.endGroup() }
    return next
  }
}
module.exports = { ProjectHistory }
