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
import lzma from 'lzma-native';

const ROOT_DIR = cwd();
const TEMP_DIR = path.join(ROOT_DIR, 'aria2c_tmp');

const platforms = {
    linux: {
        x64: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0.tar.xz'
    },
    win32: {
        x64: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
        ia32: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-32bit-build1.zip'
    }
};

const archAliases = {
    x64: 'x64',
    amd64: 'x64',
    ia32: 'ia32',
    aarch64: 'arm64',
    arm64: 'arm64'
};

export async function downloadAndExtractAria2c() {
    const platform = os.platform();
    const archRaw = os.arch();
    const arch = archAliases[archRaw] || archRaw;

    const binaryName = platform === 'win32' ? 'aria2c.exe' : 'aria2c';
    const destPath = path.join(ROOT_DIR, binaryName);

    // ✅ Skip if already exists
    if (existsSync(destPath)) {
        console.log(`✅ aria2c already exists at: ${destPath}`);
        return destPath;
    }

    const url = platforms[platform]?.[arch];
    if (!url) throw new Error(`❌ Unsupported platform/arch: ${platform}/${arch}`);

    const fileName = path.basename(url);
    const archivePath = path.join(TEMP_DIR, fileName);

    await fsPromises.mkdir(TEMP_DIR, { recursive: true });

    // Download
    if (!existsSync(archivePath)) {
        console.log("⬇️  Downloading aria2c:", fileName);
        const response = await axios({ method: 'get', url, responseType: 'stream' });
        await pipeline(response.data, createWriteStream(archivePath));
        console.log("✅ Downloaded:", fileName);
    }

    // Extract
    if (fileName.endsWith('.tar.xz')) {
        const tarPath = archivePath.replace(/\.xz$/, '');
        await pipeline(
            fs.createReadStream(archivePath),
            lzma.createDecompressor(),
            fs.createWriteStream(tarPath)
        );
        await tar.x({ file: tarPath, cwd: TEMP_DIR });
    } else if (fileName.endsWith('.zip')) {
        await fs.createReadStream(archivePath).pipe(unzipper.Extract({ path: TEMP_DIR })).promise();
    }

    // Locate aria2c binary
    const aria2cPath = findAria2cBinary(TEMP_DIR);
    if (!aria2cPath) throw new Error('❌ aria2c binary not found after extraction.');

    // Move to project root
    await fsPromises.copyFile(aria2cPath, destPath);
    if (platform !== 'win32') {
        await fsPromises.chmod(destPath, 0o755);
    }

    // Cleanup
    rmSync(TEMP_DIR, { recursive: true, force: true });

    console.log("✅ aria2c is ready at:", destPath);
    return destPath;
}

function findAria2cBinary(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = findAria2cBinary(fullPath);
            if (nested) return nested;
        } else if (
            entry.name === 'aria2c' ||
            entry.name === 'aria2c.exe'
        ) {
            return fullPath;
        }
    }

    return null;
}