// Keep this identity stable across portable builds and installed upgrades.
module.exports = {
  name: 'music-visualizer', // Existing Electron user-data directory; do not rename.
  productName: 'MusicMeters',
  version: '1.3.0',
  appId: 'com.bluehopper6.musicmeters',
  executable: 'MusicMeters.exe',
  macosExecutable: 'MusicMeters',
  macosBundleName: 'MusicMeters.app',
  macosIconFile: 'music-meters.icns',
  macosMinimumSystemVersion: '12.0',
}
