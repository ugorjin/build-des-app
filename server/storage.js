'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Content-addressed blob store: files live at <root>/<aa>/<sha256>.
function createStorage(root) {
  fs.mkdirSync(root, { recursive: true });

  const blobPath = (sha) => {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('bad blob id');
    return path.join(root, sha.slice(0, 2), sha);
  };

  function put(buffer) {
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const dest = blobPath(sha);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, dest);
    }
    return sha;
  }

  // Moves an uploaded temp file into the store, hashing it as a stream so
  // large drawings are never held in memory.
  async function putFile(tmpPath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(tmpPath)) hash.update(chunk);
    const sha = hash.digest('hex');
    const dest = blobPath(sha);
    if (fs.existsSync(dest)) {
      fs.rmSync(tmpPath, { force: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(tmpPath, dest);
    }
    return sha;
  }

  return { put, putFile, blobPath };
}

module.exports = { createStorage };
