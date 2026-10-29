const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveProjectAudio, projectAudioReference } = require('../project-audio.cjs')

test('relative audio references keep pointing at the same original after moving a project', () => {
  const source = path.resolve('artifacts/audio-reference/project/project.json')
  const target = path.resolve('artifacts/audio-reference/moved/project.json')
  const song = path.resolve('artifacts/audio-reference/music/song.wav')
  assert.equal(resolveProjectAudio(target, projectAudioReference(target, song)), song)
  assert.equal(resolveProjectAudio(source, '../music/song.wav'), song)
  assert.equal(projectAudioReference(target, ''), '')
  assert.equal(resolveProjectAudio(target, ''), '')
})

test('Windows cross-drive references preserve the original local song without copying', { skip: process.platform !== 'win32' }, () => {
  const song = 'C:\\Music\\song.wav', project = 'D:\\Projects\\Example\\Example.json'
  assert.equal(projectAudioReference(project, song), 'C:/Music/song.wav')
  assert.equal(resolveProjectAudio(project, projectAudioReference(project, song)), song)
})

test('audio references reject network/device paths, drive-relative paths, URLs and invalid values', () => {
  const project = path.resolve('artifacts/audio-reference/project.json')
  for (const ref of [null, 123, 'x'.repeat(4097), 'bad\u0000.wav', '//server/music.wav', '\\\\server\\music.wav', '\\\\?\\C:\\song.wav', 'C:song.wav', 'https://example.com/song.wav', 'C:/song.wav:stream', '/absolute/song.wav']) {
    assert.throws(() => resolveProjectAudio(project, ref), /Invalid project audio reference/)
  }
})
