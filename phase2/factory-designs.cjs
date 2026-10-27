const { compositionProject, normalizeProject, imageLayer, textLayer, waterfallLayer,
  waveformLayer, spectrumLayer, oscilloscopeLayer, spectrogramLayer, vectorscopeLayer,
  vuLayer, loudnessLayer } = require('./project.cjs')

const DESIGN_NAMES = ['Afterglow', 'Contour', 'Night Radio', 'Observatory',
  'Synthwave', 'Minimalist Ambient', 'Social', 'Hyper Chase']

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
  } else if (name === 'Observatory') {
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
  } else {
    const backgrounds = {
      'Synthwave': ['#080512', '#190e29'],
      'Minimalist Ambient': ['#090f10', '#131b1a'],
      Social: ['#0a101c', '#19273d'],
      'Hyper Chase': ['#030609', '#080e14'],
    }
    const [color, color2] = backgrounds[name]
    layout.background = { type: 'gradient', color, color2, imagePath: '', fit: 'cover' }
    const footer = (color, portrait = false) => portrait ? [
      text('genre', 'genre / slowed + reverb', 72, 1184, 546, 16, color),
      text('musicmeters', 'MUSICMETERS', 72, 1216, 546, 17, color),
    ] : [
      text('musicmeters', 'MUSICMETERS', 56, 688, 350, 13, color),
      text('genre', 'genre / slowed + reverb', 875, 688, 349, 13, color, 'Consolas', 'right'),
    ]
    if (name === 'Synthwave') {
      layout.layers = [
        art(56, 64, 260, 260),
        text('album name', 'album name', 56, 362, 260, 14, '#d699c9'),
        text('song name', 'song name', 53, 411, 285, 40, '#f4ecff', 'Arial'),
        text('artist name', 'artist name', 56, 445, 260, 19, '#a2b7d0'),
        { ...vuLayer(id('vu'), 'vu meter'), x: 76, y: 497, w: 200, h: 124,
          color: '#48d9e8', orientation: 'vertical' },
        { ...waterfall(365, 75, 560, 216), color: '#e873b6', density: 'dense' },
        { ...waveform(365, 335, 560, 112, '#72d9e4'), scrollSpeed: 2 },
        { ...spectrumLayer(id('spectrum'), 'spectrum'), x: 365, y: 489, w: 560, h: 128, color: '#b899ea' },
        { ...vectorscopeLayer(id('vectorscope'), 'vectorscope'), x: 991, y: 76, w: 220, h: 216,
          color: '#72d9e4', mode: 'polar-bipolar', showGrid: true },
        { ...loudnessLayer(id('loudness'), 'loudness'), x: 1010, y: 349, w: 200, h: 266, color: '#df78b3' },
        divider('footer', 56, 650, 1168, '#3d304b'),
        ...footer('#b59cbe'),
      ]
    } else if (name === 'Minimalist Ambient') {
      layout.layers = [
        text('album name', 'album name', 340, 66, 600, 14, '#91a69c', 'Consolas', 'center'),
        art(470, 106, 340, 340),
        { ...vectorscopeLayer(id('vectorscope'), 'vectorscope'), x: 118, y: 229, w: 188, h: 188,
          color: '#a3bcaa', showGrid: false },
        { ...vuLayer(id('vu'), 'vu meter'), x: 979, y: 282, w: 220, h: 84, color: '#a3bcaa' },
        text('song name', 'song name', 340, 507, 600, 42, '#ece7d7', 'Georgia', 'center'),
        text('artist name', 'artist name', 340, 545, 600, 20, '#a0b2a9', 'Consolas', 'center'),
        { ...oscilloscope(260, 575, 760, 80), color: '#aac8b8' },
        ...footer('#8b9b95'),
      ]
    } else if (name === 'Social') {
      layout.width = 720
      layout.height = 1280
      layout.layers = [
        text('album name', 'album name', 72, 123, 546, 20, '#b5c5d7'),
        { ...art(130, 166, 460, 460), aspectLocked: true },
        text('song name', 'song name', 72, 686, 546, 51, '#f4f4ed', 'Arial'),
        text('artist name', 'artist name', 74, 732, 544, 26, '#9ddce4'),
        { ...vectorscopeLayer(id('vectorscope'), 'vectorscope'), x: 75, y: 768, w: 156, h: 156,
          color: '#88d5d3', showGrid: true },
        { ...loudnessLayer(id('loudness'), 'loudness'), x: 300, y: 785, w: 158, h: 125, color: '#88b6d1' },
        { ...oscilloscope(72, 945, 546, 80), color: '#91d5df' },
        { ...spectrumLayer(id('spectrum'), 'spectrum'), x: 72, y: 1045, w: 546, h: 80, color: '#d1b996' },
        ...footer('#9fafc4', true),
      ]
    } else {
      layout.layers = [
        text('album name', 'album name', 340, 76, 600, 14, '#92b5c4', 'Consolas', 'center'),
        { ...spectrumLayer(id('spectrum'), 'spectrum'), x: 174, y: 257, w: 380, h: 126,
          rotation: -90, color: '#8ce4ec', smoothing: 0.8 },
        art(442, 130, 380, 380),
        { ...waterfall(442, 430, 380, 80), color: '#62c9dd', opacity: 0.6,
          frequencyRangeMode: 'audible', smoothing: 0.8 },
        { ...loudnessLayer(id('loudness'), 'loudness'), x: 844, y: 130, w: 134, h: 380, color: '#38bdf8' },
        text('song name', 'song name', 340, 572, 600, 34, '#e7f9ff', 'Arial', 'center'),
        text('artist name', 'artist name', 340, 610, 600, 25, '#b5cbd3', 'Georgia', 'center'),
        ...footer('#809ba8'),
      ]
    }
  }
  return normalizeProject(layout)
}

module.exports = { DESIGN_NAMES, designStarter }
