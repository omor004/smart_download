import express from 'express';
import { execFile, spawn } from 'child_process';
import cors from 'cors';
import path from 'path';
import { cwd } from 'process';
import { downloadYtDlpForCurrentOS, getYtDlpFileName } from './src/utils/yt-dlp.js';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import { downloadAndExtractFfmpeg } from './src/utils/downloadFfmpeg.js';
import { downloadAndExtractAria2c } from './src/utils/aria2.js';




const execFileAsync = promisify(execFile);



const app = express();
const PORT = 3000;



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(cwd(), 'public')));

const ffmpegPath = os.platform() === 'win32' ? path.resolve('./ffmpeg.exe') : 'ffmpeg';
const ariaPath = os.platform() === 'win32' ? path.resolve('./aria2c.exe') : path.resolve('./aria2c');
const ytDlpPath = path.join(cwd(), getYtDlpFileName())
const cookies = path.resolve("./cookie.txt")
const metadataArgs = [
  '--cookies', cookies,
  '--force-ipv4',
  "--no-check-certificate"

];

const downloadArgs = [
  '--cookies', cookies,
  '--force-ipv4',
  '-N', '16',
  '--downloader', 'aria2c',
  '--downloader-path', `aria2c:${ariaPath}`,
  '--downloader-args', 'aria2c: -x 16 -k 1M'
];
// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(cwd(), 'public', 'index.html'));
});


async function getVideoInfo(url) {
  const { stdout } = await execFileAsync(ytDlpPath, ['-j', '--cookies', 'cookies.txt', url]);
  return JSON.parse(stdout);
}

app.get('/download', async (req, res) => {
  const { url, video, audio } = req.query;

  if (!url || (!video && !audio)) {
    return res.status(400).json({ error: 'Missing required parameters: url, video/audio' });
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid URL protocol' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const id = uuidv4();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-'));
  const outputPath = path.join(tempDir, `${id}.%(ext)s`);

  const args = [
    '-o', outputPath,
    '--cookies', 'cookies.txt',
    '--no-playlist',
    '--restrict-filenames',
    '--quiet',
    '--ffmpeg-location', ffmpegPath
  ];

  let formatCode, quality;


  try {
    const info = await getVideoInfo(url);
    const title = (info.title || 'video').replace(/[^\w\-]+/g, '_');

    if (audio && !video) {
      // Audio-only
      formatCode = 'bestaudio';
      quality = 'audio';
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '5');
    } else if (video && audio) {
      // Merged video + audio
      quality = `${video}_${audio}`;
      if (url.includes("tiktok")) {
        formatCode = video;
      } else if (url.includes("youtu")) {
        formatCode = `${video}+140`;
        args.push('--merge-output-format', 'mp4');
      } else {
        formatCode = `${video}+${audio}`
        args.push('--merge-output-format', 'mp4');
      }
    } else if (video && !audio) {
      // Video-only
      formatCode = video;
      quality = `${video}_video_only`;
    } else {
      return res.status(400).json({ error: 'Invalid format combination' });
    }

    args.push('-f', formatCode, url);

    await execFileAsync(ytDlpPath, args);

    const files = await fs.readdir(tempDir);
    const file = files.find(f => f.startsWith(id));
    if (!file) return res.status(500).json({ error: 'Download failed' });

    const filePath = path.join(tempDir, file);
    const ext = path.extname(file).slice(1);
    const finalName = `${title}_${quality}.${ext}`;

    res.download(filePath, finalName, async err => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(console.error);
      if (err) console.error('Download error:', err);
    });

  } catch (err) {
    console.error('Facebook download error:', err);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(console.error);
    res.status(500).json({ error: err.message || 'Failed to download Facebook video' });
  }
});



app.post('/formats', (req, res) => {
  const videoUrl = req.body.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL' });
  }

  // Separated args


  const getFormats = (title, description, thumbnail) => {
    execFile(ytDlpPath, ['-F', ...metadataArgs, videoUrl], (error, stdout, stderr) => {
      if (error || stderr) {
        return res.status(500).json({ error: stderr || error.message });
      }

      const lines = stdout.split('\n');
      const formatLines = lines.filter(line => /^\S+\s+\S+\s+\S+/.test(line.trim()));

      const formats = formatLines.map(line => {
        const parts = line.trim().split(/\s+/);
        const code = parts[0];
        const extension = parts[1];
        const resolution = parts[2];
        const rawNote = parts.slice(3).join(' ');

        if (rawNote.includes('m3u8') || rawNote.toLowerCase().includes('watermarked')) return null;
        if (!["mp4", "mp3", "m4a"].includes(extension)) return null;

        const sizeMatch = rawNote.match(/(\d+(?:\.\d+)?)(KiB|MiB|GiB)/);
        let sizeBytes = null;
        if (sizeMatch) {
          const value = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2];
          const multipliers = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
          sizeBytes = value * multipliers[unit];
        }

        if (!sizeBytes) return null;

        const size = {
          byte: `${Math.round(sizeBytes)} B`,
          kb: `${(sizeBytes / 1024).toFixed(1)} KB`,
          mb: `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`,
          gb: `${(sizeBytes / 1024 / 1024 / 1024).toFixed(4)} GB`
        };

        const bitrateMatch = rawNote.match(/(\d+k)/);
        const codecMatch = rawNote.match(/([a-z0-9]+\.[a-z0-9]+(?:, [a-z0-9\.]+)*)/i);

        return {
          code,
          extension,
          resolution,
          size,
          bitrate: bitrateMatch ? bitrateMatch[1] : null,
          codecs: codecMatch ? codecMatch[1] : null,
          rawNote
        };
      }).filter(Boolean);

      const isPopularResolution = res => {
        const standard = ['144', '240', '270', '288', '320', '360', '384', '480', '512', '540', '576', '640', '720', '800', '900', '960', '1024', '1080', '1200', '1280', '1440', '1600', '1800', '1920', '2048', '2160', '2400', '2560', '2880', '3200', '3840', '4096', '4320', '5120', '7680'];
        return standard.some(r => res.includes(r + 'p')) || /\d+x\d+/.test(res);
      };

      const filtered = formats.filter(format => {
        const res = format.resolution.toLowerCase();
        const isAudio = res === 'audio' || /audio only/.test(format.rawNote);
        return isAudio || isPopularResolution(res);
      });

      const uniqueByResolution = [...filtered].reverse().filter((item, index, self) =>
        index === self.findIndex(f => f.resolution === item.resolution)
      ).reverse();

      res.json({
        title,
        description,
        thumbnail,
        videoUrl,
        formats: uniqueByResolution
      });
    });
  };

  // Try simple metadata first
  execFile(ytDlpPath, ['--no-playlist', ...metadataArgs, '--print', '%(title)s\n%(description)s\n%(thumbnail)s', videoUrl], (errMeta, metaOut, metaErr) => {
    const lines = metaOut ? metaOut.trim().split('\n') : [];

    if (errMeta || metaErr || lines.length < 3 || !lines[2].startsWith('http')) {
      // Fallback to JSON
      execFile(ytDlpPath, ['-j', ...metadataArgs, videoUrl], (jsonErr, jsonOut, jsonStderr) => {
        if (jsonErr || jsonStderr) {
          return res.status(500).json({ error: jsonStderr || jsonErr.message });
        }

        try {
          const json = JSON.parse(jsonOut);
          const { title, description, thumbnail } = json;
          getFormats(title, description, thumbnail);
        } catch (e) {
          console.error('JSON parse failed:', jsonOut);
          return res.status(500).json({ error: 'Failed to parse metadata' });
        }
      });
    } else {
      const [title, description, thumbnail] = lines;
      getFormats(title.trim(), description.trim(), thumbnail.trim());
    }
  });
});






// Start server
app.listen(PORT, async () => {
  await downloadYtDlpForCurrentOS();
  await downloadAndExtractFfmpeg();
  await downloadAndExtractAria2c();

  const ytdlpV = spawn(ytDlpPath, ['--version']);
  const ffmpegV = spawn(ffmpegPath, ['-version']);
  const aria2V = spawn(ariaPath, ['-v']);

  ytdlpV.stdout.on('data', (data) => {
    console.log(`📦 yt-dlp version: ${data.toString().trim()}`);
  });

  ffmpegV.stdout.on('data', (data) => {
    console.log(`🎞️ ffmpeg version: ${data.toString().split('\n')[0]}`);
  });

  aria2V.stdout.on('data', (data) => {
    console.log(`📡 aria2c version: ${data.toString().split('\n')[0]}`);
  });

  console.log(`✅ Server running at http://localhost:${PORT}`);
});

