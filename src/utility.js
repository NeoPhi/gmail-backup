import crypto from 'crypto';
import path from 'path';

export function groupDirectory(directory, group) {
  var hash = crypto.createHash('sha1').update(group).digest('hex');
  return path.join(directory, hash.substr(0, 2), hash.substr(2, 2));
}
