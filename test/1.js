import path from 'path';
import os from 'os';
import fsPromises from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { cwd } from 'process';
import axios from 'axios';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);
const ytDlpDir = cwd(); // Project root

const binaries = {
  win32: {
    x64: {
      filename: 'yt-dlp.exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    },
    ia32: {
      filename: 'yt-dlp_x86.exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_x86.exe'
    }
  },
  linux: {
    x64: {
      filename: 'yt-dlp_linux',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
    },
    armv7l: {
      filename: 'yt-dlp_linux_armv7l',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_armv7l'
    },
    aarch64: {
      filename: 'yt-dlp_linux_aarch64',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64'
    }
  },
  darwin: {
    x64: {
      filename: 'yt-dlp_macos_legacy',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos_legacy'
    },
    arm64: {
      filename: 'yt-dlp_macos',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    }
  }
};

const archMap = {
  x64: 'x64',
  ia32: 'ia32',
  arm: 'armv7l',
  arm64: 'aarch64'
};

export async function downloadYtDlpForCurrentOS() {
  const platform = os.platform();
  const arch = archMap[os.arch()];

  if (!binaries[platform] || !binaries[platform][arch]) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
  }

  const { filename, url } = binaries[platform][arch];
  const binaryPath = path.join(ytDlpDir, filename);

  if (existsSync(binaryPath)) {
    console.log(`✅ yt-dlp already exists: ${filename}`);
    return binaryPath;
  }

  console.log(`⬇️  Downloading yt-dlp for ${platform}/${arch}...`);
  await downloadFile(url, binaryPath);

  if (platform !== 'win32') {
    await fsPromises.chmod(binaryPath, 0o755); // Make executable
  }

  console.log(`✅ Downloaded ${filename}`);
  return binaryPath;
}

export function getYtDlpFileName() {
  const platform = os.platform();
  const arch = archMap[os.arch()];

  if (!binaries[platform] || !binaries[platform][arch]) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
  }

  return binaries[platform][arch].filename;
}

async function downloadFile(url, destPath) {
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      maxRedirects: 5
    });

    const writer = createWriteStream(destPath);
    await streamPipeline(response.data, writer);
  } catch (error) {
    throw new Error(`Failed to download ${url}: ${error.message}`);
  }
}
