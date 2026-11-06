const PALETTES = Object.freeze({
  prism: { name:'Prism Classic', colors:['#00ffff','#ff477e','#44dd44'] },
  neon: { name:'Cyan & Magenta', colors:['#43f7ef','#f472ff','#8d7dff'] },
  ember: { name:'Ember', colors:['#ffb454','#ff5c7c','#ffe6a7'] },
  ice: { name:'Ice', colors:['#8de4ff','#8eafff','#e0f7ff'] },
  forest: { name:'Forest', colors:['#8ee3a1','#e0e890','#48bca9'] },
  mono: { name:'Monochrome', colors:['#f0f1f5','#a9b0bf','#d8dfeb'] },
})
function normalizeAppearance(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid meter appearance')
  const result={}
  for (const key of ['gridColor','labelColor','secondaryColor','fillLowColor','fillMidColor','fillHighColor','scopeFillColor','phaseRiskColor']) {
    if (value[key]===undefined) continue
    if (typeof value[key]!=='string' || !/^#[a-f0-9]{6}$/i.test(value[key])) throw new Error('Invalid meter appearance color')
    result[key]=value[key]
  }
  for (const [key,min,max] of [['lineWidth',0.5,8],['gridOpacity',0,1],['labelOpacity',0,1],['fillOpacity',0,1],['scopeFillOpacity',0,1]]) {
    if (value[key]===undefined) continue
    if (typeof value[key]!=='number' || !Number.isFinite(value[key]) || value[key]<min || value[key]>max) throw new Error('Invalid meter appearance '+key)
    result[key]=value[key]
  }
  if (value.fillMode!==undefined) {
    if (!['none','gradient','heat'].includes(value.fillMode)) throw new Error('Invalid spectrum fill mode')
    result.fillMode=value.fillMode
  }
  if (value.showGrid!==undefined) {
    if (typeof value.showGrid!=='boolean') throw new Error('Invalid meter appearance grid')
    result.showGrid=value.showGrid
  }
  return result
}
function alpha(color,opacity) {
  return `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},${opacity})`
}
function appearanceDefaults(layer) {
  const type=layer.type
  return {
    lineWidth:1.5, gridColor:type==='waterfall'?'#808080':'#ffffff',
    gridOpacity:type==='waterfall'?0.25:type==='waveform'?0.08:type==='vu'||type==='spectrogram'?0.12:type==='loudness'?0.35:0.1,
    labelColor:type==='waterfall'?'#999999':'#ffffff',
    labelOpacity:type==='vectorscope'?0.1:type==='waterfall'?1:type==='loudness'?0.8:type==='vu'?0.5:0.4,
    secondaryColor:'#ed89f5', phaseRiskColor:'#ffbf00', fillMode:'none', fillOpacity:0.5,
    fillLowColor:'#0f0721',fillMidColor:'#a31a79',fillHighColor:'#fff1d1',
    scopeFillColor:'#f5f8fc',scopeFillOpacity:0.18,
  }
}
function nativeAppearance(layer) {
  const a=layer.appearance
  if (!a) return {}
  const defaults=appearanceDefaults(layer)
  const options={}
  if (a.gridColor!==undefined || a.gridOpacity!==undefined) {
    const color=a.gridColor ?? defaults.gridColor,opacity=a.gridOpacity ?? defaults.gridOpacity
    options.gridColor=options.gridMajorColor=options.scaleColor=alpha(color,opacity)
    options.gridMinorColor=alpha(color,opacity/2)
  }
  if (a.labelColor!==undefined || a.labelOpacity!==undefined) options.labelColor=alpha(a.labelColor??defaults.labelColor,a.labelOpacity??defaults.labelOpacity)
  if (a.secondaryColor!==undefined) options.secondaryLineColor=a.secondaryColor
  if (a.phaseRiskColor!==undefined) options.phaseRiskColor=a.phaseRiskColor
  if (a.showGrid!==undefined && layer.type==='spectrum') options.showGrid=a.showGrid
  if (a.fillMode!==undefined) {
    options.fillGradient=a.fillMode==='gradient';options.heatmapFill=a.fillMode==='heat'
  }
  if (['fillMode','fillLowColor','fillMidColor','fillHighColor','fillOpacity'].some(key=>a[key]!==undefined)) {
    const colors=[a.fillLowColor??defaults.fillLowColor,a.fillMidColor??defaults.fillMidColor,a.fillHighColor??defaults.fillHighColor]
    options.heatColors=colors
    options.gradientColors=colors.map((color,index)=>alpha(color,(a.fillOpacity??defaults.fillOpacity)*[0.08,0.5,1][index]))
  }
  if (a.scopeFillColor!==undefined || a.scopeFillOpacity!==undefined) options.underfillColor=alpha(a.scopeFillColor??defaults.scopeFillColor,a.scopeFillOpacity??defaults.scopeFillOpacity)
  return options
}
function applyPalette(layer,id) {
  const palette=Object.hasOwn(PALETTES,id) ? PALETTES[id] : null
  if (!palette || ['image','text','video'].includes(layer.type)) throw new Error('Choose a meter color preset')
  const [main,secondary,third]=palette.colors
  const next={...layer,color:main,appearance:{...layer.appearance,secondaryColor:secondary,
    gridColor:main,gridOpacity:0.15,labelColor:'#e4e9f4',labelOpacity:0.6,
    fillLowColor:'#10121c',fillMidColor:main,fillHighColor:secondary,fillOpacity:0.6,scopeFillColor:main,scopeFillOpacity:0.16}}
  if (layer.type==='spectrum') next.appearance.fillMode=id==='prism'?'none':'gradient'
  if (layer.type==='vectorscope' || layer.type==='waveform') Object.assign(next,{bandLowColor:secondary,bandMidColor:third,bandHighColor:main})
  if (layer.type==='vu') Object.assign(next,{peakColor:secondary,needleLeftColor:main,needleRightColor:secondary,needleCombinedColor:third})
  if (layer.type==='loudness') next.targetColor=secondary
  return next
}
module.exports={PALETTES,normalizeAppearance,appearanceDefaults,nativeAppearance,applyPalette}

// Derive the label from applied colors so old projects, templates and Undo agree.
function matchingPalette(layer) {
  if (['image','text','video'].includes(layer.type)) return ''
  for (const id of Object.keys(PALETTES)) {
    const expected=applyPalette(layer,id)
    const keys=['color','bandLowColor','bandMidColor','bandHighColor','peakColor','needleLeftColor','needleRightColor','needleCombinedColor','targetColor']
    const appearanceKeys=['secondaryColor','gridColor','gridOpacity','labelColor','labelOpacity','fillLowColor','fillMidColor','fillHighColor','fillOpacity','scopeFillColor','scopeFillOpacity',...(layer.type==='spectrum'?['fillMode']:[])]
    if (keys.every(key=>expected[key]===layer[key]) && appearanceKeys.every(key=>expected.appearance[key]===layer.appearance?.[key])) return id
  }
  return ''
}
module.exports.matchingPalette=matchingPalette
