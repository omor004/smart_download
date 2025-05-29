import express from 'express';
import { execFile } from 'child_process';
import cors from 'cors';
import path from 'path';
import { cwd } from 'process';
import { downloadYtDlpForCurrentOS, getYtDlpFileName } from './src/utils/yt-dlp.js';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import { downloadAndExtractFfmpeg } from './src/utils/downloadFfmpeg.js';




const execFileAsync = promisify(execFile);



const app = express();
const PORT = 3000;



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(cwd(), 'public')));

// Hardcoded path to yt-dlp.exe (Windows only)

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(cwd(), 'public', 'index.html'));
});

const ffmpegPath = os.platform() === 'win32' ? path.resolve('./ffmpeg.exe') : 'ffmpeg';
const ytDlpPath = path.join(cwd(), getYtDlpFileName())

async function getVideoInfo(url) {
  const { stdout } = await execFileAsync(ytDlpPath, ['-j', url]);
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



app.get('/formats', (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL' });
  }

  const getFormats = (title, description, thumbnail) => {
    execFile(ytDlpPath, ['-F', videoUrl], (error, stdout, stderr) => {
      if (error) {
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

        if (rawNote.includes('m3u8')) return null;
        if (rawNote.toLowerCase().includes('watermarked')) return null;

        const sizeMatch = rawNote.match(/(\d+(?:\.\d+)?)(KiB|MiB|GiB)/);
        let sizeBytes = null;
        if (sizeMatch) {
          const value = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2];
          const multipliers = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
          sizeBytes = value * multipliers[unit];
        }

        const size = sizeBytes
          ? {
            byte: `${Math.round(sizeBytes)} B`,
            kb: `${(sizeBytes / 1024).toFixed(1)} KB`,
            mb: `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`,
            gb: `${(sizeBytes / 1024 / 1024 / 1024).toFixed(4)} GB`
          }
          : null;

        if (size === null) return

        if (!["mp4", "mp3", "m4a"].includes(extension)) return;


        const bitrateMatch = rawNote.match(/(\d+k)/);
        const codecMatch = rawNote.match(/([a-z0-9]+\.[a-z0-9]+(?:, [a-z0-9\.]+)*)/i);

        return {
          code,
          extension,
          resolution,
          size,
          bitrate: bitrateMatch ? bitrateMatch[1] : null,
          codecs: codecMatch ? codecMatch[1] : null,
          rawNote,

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

  execFile(ytDlpPath, ['--no-playlist', '--print', '%(title)s\n%(description)s\n%(thumbnail)s', videoUrl], (errMeta, metaOut) => {
    const lines = metaOut ? metaOut.trim().split('\n') : [];

    if (errMeta || lines.length < 3 || !lines[2].startsWith('http')) {
      execFile(ytDlpPath, ['-j', videoUrl], (jsonErr, jsonOut) => {
        if (jsonErr) {
          return res.status(500).json({ error: jsonErr.message });
        }

        try {
          const json = JSON.parse(jsonOut);
          const { title, description, thumbnail } = json;
          getFormats(title, description, thumbnail);
        } catch (e) {
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
  await downloadYtDlpForCurrentOS()
  downloadAndExtractFfmpeg()
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
