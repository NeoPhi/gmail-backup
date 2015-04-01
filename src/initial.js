import IMAP from 'imap';
import util from 'util';
import * as config from './config';
import * as utility from './utility';
import temp from 'temp';
import fs from 'fs';
import path from 'path';
import mkdirp from 'mkdirp';
import async from 'async';

temp.track();

const inspect = util.inspect;

const connection = new IMAP({
  user: config.user,
  password: config.password,
  host: 'imap.gmail.com',
  port: 993,
  tls: true
});

function finish(error) {
  connection.end();
  if (error) {
    console.log('ERROR', error.toString());
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function saveMessage(messageContext, data, tempFile) {
  return new Promise((resolve, reject) => {
    if (!data.uid) {
      return reject(new Error(messageContext + ' missing UID'));
    }
    const uid = data.uid.toString();
    const directory = utility.groupDirectory(config.directory, uid);
    mkdirp.mkdirp(directory, (error) => {
      if (error) {
        return reject(error);
      }
      async.parallel([
        (callback) => {
          const newPath = path.join(directory, uid + '.msg');
          fs.rename(tempFile, newPath, callback);
        },
        (callback) => {
          const newPath = path.join(directory, uid + '.json');
          fs.writeFile(newPath, JSON.stringify(data, null, '  '), callback);
        }
      ], (error) => {
        if (error) {
          return reject(error);
        }
        resolve(messageContext);
      });
    });
  });
}

function fetchBatch(start, stop, callback) {
  const fetchContext = ['fetch', start, stop].join(':');
  console.log(fetchContext, 'START');
  const fetch = connection.fetch([start, stop].join(':'), {
    bodies: ''
  });
  const promises = [];
  fetch.on('message', (message, seqno) => {
    promises.push(new Promise((resolve, reject) => {
      const tempFile = temp.path({
        dir: config.directory,
        suffix: '.msg'
      });
      console.log(fetchContext, 'MESSAGE', seqno);
      const messageContext = [fetchContext, 'message', seqno].join(':');
      let bodyPromise;
      message.on('body', (stream) => {
        console.log(messageContext, 'BODY');
        bodyPromise = new Promise((resolve) => {
          const output = fs.createWriteStream(tempFile);
          output.on('finish', resolve);
          stream.pipe(output);
        });
      });
      let data = {};
      message.on('attributes', (attributes) => {
        console.log(messageContext, 'ATTRIBUTES');
        data = attributes;
      });
      message.once('end', () => {
        console.log(messageContext, 'END');
        bodyPromise.then(() => {
          return saveMessage(messageContext, data, tempFile);
        }).then(resolve, reject);
      });
    }));
  });
  fetch.on('error', (error) => {
    return finish(error);
  });
  fetch.once('end', () => {
    console.log(fetchContext, 'END');
    Promise.all(promises).then(() => {
      console.log(fetchContext, 'END', 'PROMISE');
      callback();
    }).catch((error) => {
      console.log(fetchContext, 'END', 'ERROR');
      callback(error);
    });
  });
}

function createStatus(mailbox, callback) {
  fs.readFile(path.join(config.directory, 'status.json'), (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return callback(undefined, {
          start: 1,
          uidvalidity: mailbox.uidvalidity,
          uidnext: mailbox.uidnext
        });
      }
      return callback(error);
    }
    try {
      const status = JSON.parse(data.toString());
      if (status.uidvalidity !== mailbox.uidvalidity) {
        return callback(new Error('uidvalidity change'));
      }
      if (status.uidnext < mailbox.uidnext) {
        return callback(new Error('uidnext issue'));
      }
      status.uidnext = mailbox.uidnext;
      return callback(undefined, status);
    } catch(error) {
      return callback(error);
    }
  });
}

function next(status) {
  fetchBatch(status.start, status.start + 99, (error) => {
    if (error) {
      return finish(error);
    }
    status.start += 100;
    fs.writeFile(path.join(config.directory, 'status.json'), JSON.stringify(status, null, '  '), (error) => {
      if (error) {
        return finish(error);
      }
      next(status);
    });
  });
}

connection.once('ready', () => {
  console.log('connection', 'READY');
  connection.openBox('[Gmail]/All Mail', true, (error, mailbox) => {
    if (error) {
      return finish(error);
    }
    console.log('openBox', 'INFO', inspect(mailbox));
    createStatus(mailbox, (error, status) => {
      if (error) {
        return finish(error);
      }
      next(status);
    });
  });
});

connection.on('alert', (message) => {
  console.log('connection', 'ALERT', message);
});

connection.on('mail', (numNewMsgs) => {
  console.log('connection', 'MAIL', numNewMsgs);
});

connection.on('expunge', (seqno) => {
  console.log('connection', 'EXPUNGE', seqno);
});

connection.on('uidvalidity', (uidvalidity) => {
  finish(new Error('UIDVALIDITY changed ' + uidvalidity));
});

connection.on('update', (seqno, info) => {
  console.log('connection', 'UPDATE', seqno, info);
});

connection.on('error', (error) => {
  finish(error);
});

connection.on('close', (hadError) => {
  console.log('connection', 'CLOSE', hadError);
});

connection.once('end', () => {
  console.log('connection', 'END');
});

connection.connect();
