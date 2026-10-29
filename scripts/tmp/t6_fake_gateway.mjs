// scripts/tmp/t6_fake_gateway.mjs — a minimal self-hosted GPU gateway stub for
// live browser verification of the T6a hosted-provider path. Serves the
// two-endpoint queue contract plus one tiny "rendered" MP4.
import http from 'node:http'

const PORT = 9911
const CLIP = Buffer.from('T6A-FAKE-GATEWAY-MP4-BYTES-0123456789abcdef')
let polls = 0

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'

  if (url === '/clip.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(CLIP.length) })
    res.end(CLIP)
    return
  }

  if (req.method === 'POST' && url === '/v1/video/jobs') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      console.log('[gateway] submit:', chunks.join(''))
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'gw-live-1' }))
    })
    return
  }

  if (req.method === 'GET' && url === '/v1/video/jobs/gw-live-1') {
    // one queued poll, one running poll, then success with the clip
    polls += 1
    if (polls === 1) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'queued' }))
    } else if (polls === 2) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'running', progress: 55 }))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'succeeded',
          video_url: `http://127.0.0.1:${PORT}/clip.mp4`,
          frames: [],
        })
      )
    }
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gateway] fake GPU queue listening on http://127.0.0.1:${PORT}`)
})
