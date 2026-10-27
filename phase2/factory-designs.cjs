const { compositionProject, normalizeProject, imageLayer, textLayer, waterfallLayer,
  waveformLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, vectorscopeLayer,
  vuLayer, loudnessLayer } = require('./project.cjs')

const DESIGN_NAMES = ['Afterglow', 'Contour', 'Night Radio', 'Observatory']

function designStarter(name) {
  if (!DESIGN_NAMES.includes(name)) throw new Error('Unknown factory design')
  const prefix = name.toLowerCase().replaceAll(' ', '-')
  const id = suffix => `${prefix}-${suffix}`
  const text = (name, content, x, baseline, w, size, color, font = 'Consolas', align = 'left') => ({
    ...textLayer(id(name.replaceAll(' ', '-')), name, content),
    x, y: Math.round(baseline - size), w, h: Math.max(20, Math.round(size * 1.4)),
    fontSize: size, color, fontFamily: font, fontWeight: 'normal', align,
  })
  // Empty visible image layers block playback/export. Choosing artwork enables it.
  const art = (x, y, w, h) => ({ ...imageLayer(id('artwork'), 'artwork'), x, y, w, h, visible: false })
  const waterfall = (x, y, w, h) => ({
    ...waterfallLayer(id('waterfall'), 'waterfall'), x, y, w, h,
    color: '#8be1cf', showGrid: false,
  })
  const waveform = (x, y, w, h, color) => ({
    ...waveformLayer(id('waveform'), 'waveform'), x, y, w, h, color,
  })
  const oscilloscope = (x, y, w, h) => ({
    ...oscilloscopeLayer(id('oscilloscope'), 'oscilloscope'), x, y, w, h,
    color: '#8be1cf', showGrid: false,
  })
  // Overfill each separator; the text painter fits it to the exact layer width.
  const divider = (suffix, x, baseline, w, color) =>
    text(`divider ${suffix}`, '─'.repeat(Math.ceil(w / 6)), x, baseline, w, 12, color)
  const layout = compositionProject()
  layout.title = ''
  const bg = { Afterglow: '#0a101b', Contour: '#071513', 'Night Radio': '#181614', Observatory: '#090e17' }[name]
  layout.background = { type: 'solid', color: bg, color2: bg, imagePath: '', fit: 'cover' }

  if (name === 'Afterglow') {
    layout.layers = [
      art(56, 56, 478, 568),
      text('album name', 'album name', 580, 83, 630, 13, '#b0bfc7'),
      text('song name', 'song name', 578, 220, 632, 79, '#f3eee7', 'Georgia'),
      text('artist name', 'artist name', 583, 298, 627, 17, '#a9b7c7'),
      waterfall(580, 350, 630, 170),
      waveform(580, 537, 630, 80, '#bcb2d9'),
      divider('footer', 56, 658, 1168, '#303641'),
      text('musicmeters', 'MUSICMETERS', 56, 688, 350, 13, '#a6adb7'),
      text('genre', 'genre / slowed + reverb', 875, 688, 349, 13, '#a6adb7'),
    ]
  } else if (name === 'Contour') {
    layout.layers = [
      text('artist name', 'artist name', 62, 69, 800, 15, '#b8cec4'),
      text('song name', 'song name', 57, 150, 870, 70, '#e5eddb', 'Georgia'),
      divider('header', 62, 185, 1156, '#2a3b33'),
      waterfall(55, 243, 860, 315),
      art(997, 236, 220, 162),
      text('album name', 'album name', 998, 425, 220, 16, '#b8cec4', 'Georgia'),
      oscilloscope(996, 455, 220, 95),
      waveform(62, 570, 1155, 80, '#80b5a9'),
      text('musicmeters', 'MUSICMETERS', 62, 688, 350, 13, '#86a095'),
      text('genre', 'genre / slowed + reverb', 875, 688, 342, 13, '#86a095'),
    ]
  } else if (name === 'Night Radio') {
    layout.layers = [
      text('album name', 'album name', 54, 64, 760, 16, '#d5ba8d'),
      text('song name', 'song name', 52, 146, 760, 59, '#eee4d2', 'Georgia'),
      text('artist name', 'artist name', 55, 188, 760, 23, '#bfae98', 'Georgia'),
      art(890, 49, 338, 308),
      { ...spectrumLayer(id('spectrum'), 'spectrum'), x: 55, y: 237, w: 760, h: 207, color: '#dfa06d' },
      ...[55, 431].map((x, index) => ({ ...vuLayer(id(`vu-${index + 1}`), `vu meter ${index + 1}`),
        x, y: 455, w: 340, h: 155, mode: 'needle', needleChannels: 'combined',
        color: '#ecbc85', needleCombinedColor: '#ecbc85' })),
      waveform(890, 402, 338, 156, '#b5bba1'),
      divider('footer', 55, 649, 1170, '#3a332c'),
      text('musicmeters', 'MUSICMETERS', 55, 686, 350, 13, '#d2bea1'),
      text('genre', 'genre / slowed + reverb', 888, 686, 340, 13, '#d2bea1'),
    ]
  } else {
    layout.layers = [
      art(42, 36, 102, 83),
      text('song name', 'song name', 169, 76, 700, 37, '#e5eced', 'Georgia'),
      text('artist name', 'artist name', 171, 108, 700, 14, '#9bacb9'),
      text('album name', 'album name', 933, 69, 305, 14, '#b9ccd3'),
      divider('header', 42, 144, 1196, '#30353d'),
      text('spectral history', 'SPECTRAL HISTORY', 42, 180, 706, 12, '#92a9b3'),
      text('frequency time', 'FREQUENCY / TIME', 799, 180, 439, 12, '#92a9b3'),
      waterfall(42, 205, 706, 205),
      { ...spectrogramLayer(id('spectrogram'), 'spectrogram'), x: 799, y: 206, w: 439, h: 205,
        colorScheme: 'heat', showGrid: false },
      divider('meters', 42, 438, 1196, '#30353d'),
      { ...spectrumLayer(id('spectrum'), 'spectrum'), x: 42, y: 469, w: 411, h: 163, color: '#d4ad78' },
      oscilloscope(495, 466, 266, 80),
      waveform(495, 560, 266, 80, '#8bacc6'),
      { ...vectorscopeLayer(id('vectorscope'), 'vectorscope'), x: 800, y: 473, w: 178, h: 164,
        color: '#8be1cf', showGrid: true },
      { ...vuLayer(id('vu'), 'vu meter'), x: 1020, y: 471, w: 218, h: 80, color: '#86b7cc' },
      { ...loudnessLayer(id('loudness'), 'loudness'), x: 1050, y: 566, w: 158, h: 80, color: '#86b7cc' },
      text('musicmeters', 'MUSICMETERS', 42, 690, 350, 12, '#8194a3'),
      text('genre', 'genre / slowed + reverb', 875, 690, 363, 12, '#8194a3', 'Consolas', 'right'),
    ]
  }
  return normalizeProject(layout)
}

module.exports = { DESIGN_NAMES, designStarter }
