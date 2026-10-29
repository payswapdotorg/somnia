/**
 * ffmpeg-static exports the absolute path of the platform ffmpeg binary
 * (or null when the postinstall download failed) as its default export.
 */
declare module 'ffmpeg-static' {
  const ffmpegPath: string | null
  export default ffmpegPath
}
