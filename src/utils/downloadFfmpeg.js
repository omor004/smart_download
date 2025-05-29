import os from 'os';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { existsSync, createWriteStream, readdirSync, rmSync } from 'fs';
import * as tar from 'tar';
import { cwd } from 'process';
import { pipeline } from 'stream/promises';
import unzipper from 'unzipper';

const ROOT_DIR = cwd();
const TEMP_DIR = path.join(ROOT_DIR, 'ffmpeg_tmp');

const platforms = {
  linux: {
    x64: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    arm64: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
    arm: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz'
  },
  win32: {
    x64: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  },
  darwin: {
    x64: 'https://evermeet.cx/ffmpeg/ffmpeg-7.0.1.zip',
    arm64: 'https://evermeet.cx/ffmpeg/ffmpeg-7.0.1.zip'
  }
};

const archAliases = {
  x64: 'x64',
  amd64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
  arm: 'arm'
};

export async function downloadAndExtractFfmpeg() {
  const platform = os.platform();
  const archRaw = os.arch();
  const arch = archAliases[archRaw] || archRaw;

  const destPath = path.join(ROOT_DIR, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

  // ✅ Skip if already exists
  if (existsSync(destPath)) {
    console.log(`✅ ffmpeg already exists at: ${destPath}`);
    return destPath;
  }

  const url = platforms[platform]?.[arch];
  if (!url) throw new Error(`❌ Unsupported platform/arch: ${platform}/${arch}`);

  const fileName = path.basename(url);
  const archivePath = path.join(TEMP_DIR, fileName);

  await fsPromises.mkdir(TEMP_DIR, { recursive: true });

  // Download
  if (!existsSync(archivePath)) {
    console.log(`⬇️  Downloading ffmpeg: ${fileName}`);
    const response = await axios({ method: 'get', url, responseType: 'stream' });
    await pipeline(response.data, createWriteStream(archivePath));
    console.log(`✅ Downloaded: ${fileName}`);
  }

  // Extract
  if (fileName.endsWith('.tar.xz')) {
    await tar.x({ file: archivePath, cwd: TEMP_DIR });
  } else if (fileName.endsWith('.zip')) {
    await fs.createReadStream(archivePath).pipe(unzipper.Extract({ path: TEMP_DIR })).promise();
  }

  // Locate ffmpeg binary
  const ffmpegPath = findFfmpegBinary(TEMP_DIR);
  if (!ffmpegPath) throw new Error('❌ ffmpeg binary not found after extraction.');

  // Move to project root
  await fsPromises.copyFile(ffmpegPath, destPath);
  if (platform !== 'win32') {
    await fsPromises.chmod(destPath, 0o755);
  }

  // Cleanup
  rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log(`✅ ffmpeg is ready at: ${destPath}`);
  return destPath;
}

function findFfmpegBinary(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFfmpegBinary(fullPath);
      if (nested) return nested;
    } else if (
      entry.name === 'ffmpeg' ||
      entry.name === 'ffmpeg.exe'
    ) {
      return fullPath;
    }
  }

  return null;
}
