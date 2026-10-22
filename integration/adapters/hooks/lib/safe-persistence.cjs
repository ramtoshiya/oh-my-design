'use strict';

const fs = require('node:fs');
const path = require('node:path');

const names = new Set(['preferences.md', 'timeline.md', 'foldin-proposal.json', 'config.json']);

function statePath(project, name, create) {
  if (!names.has(name)) throw new Error('Invalid state file');
  const root = fs.realpathSync(project);
  const dir = path.join(root, '.omd');
  if (create) {
    try { fs.mkdirSync(dir); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== dir) {
    throw new Error('Unsafe state directory');
  }
  return path.join(dir, name);
}

function openState(project, name, write, append = false) {
  const target = statePath(project, name, write);
  let existing;
  try { existing = fs.lstatSync(target); } catch (error) {
    if (error.code !== 'ENOENT' || !write) throw error;
  }
  if (existing && !existing.isFile()) throw new Error('Unsafe state file');
  const flags = (write ? fs.constants.O_RDWR : fs.constants.O_RDONLY)
    | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    | (append ? fs.constants.O_APPEND : 0)
    | (!existing && write ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0);
  const fd = fs.openSync(target, flags, 0o600);
  try {
    const opened = fs.fstatSync(fd);
    const current = fs.lstatSync(statePath(project, name, false));
    if (!opened.isFile() || !current.isFile()
      || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw new Error('State file changed');
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function readState(project, name) {
  let fd;
  try {
    fd = openState(project, name, false);
    return fs.readFileSync(fd, 'utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeState(project, name, text, append = false) {
  let fd;
  try {
    fd = openState(project, name, true, append);
    // Validate the descriptor before truncating an existing file.
    if (!append) fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, text, 'utf8');
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { readState, writeState };
