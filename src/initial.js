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

function finish() {
  connection.end();
  process.exit(0);
}

function saveMessage(messageContext, data, tempFile) {
  return new Promise((resolve, reject) => {
    if (!data.uid) {
      console.log(messageContext, 'ERROR', 'missing UID');
      return reject(messageContext);
    }
    const uid = data.uid.toString();
    const directory = utility.groupDirectory(config.directory, uid);
    mkdirp.mkdirp(directory, function(error) {
      if (error) {
        return reject(messageContext, error);
      }
      async.parallel([
        callback => {
          const newPath = path.join(directory, uid + '.msg');
          fs.rename(tempFile, newPath, callback);
        },
        callback => {
          const newPath = path.join(directory, uid + '.json');
          fs.writeFile(newPath, JSON.stringify(data, null, '  '), callback);
        }
      ], (error) => {
        if (error) {
          return reject(messageContext, error);
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
  fetch.on('message', function(message, seqno) {
    promises.push(new Promise((resolve, reject) => {
      let tempFile = temp.path({
        suffix: '.msg'
      });
      console.log(fetchContext, 'MESSAGE', seqno);
      const messageContext = [fetchContext, 'message', seqno].join(':');
      message.on('body', function(stream) {
        console.log(messageContext, 'BODY');
        stream.pipe(fs.createWriteStream(tempFile));
      });
      let data = {};
      message.on('attributes', function(attributes) {
        console.log(messageContext, 'ATTRIBUTES');
        data = attributes;
      });
      message.once('end', function() {
        console.log(messageContext, 'END');
        saveMessage(messageContext, data, tempFile).then(resolve, reject);
      });
    }));
  });
  fetch.on('error', function(error) {
    console.log(fetchContext, 'ERROR', error);
  });
  fetch.once('end', function() {
    console.log(fetchContext, 'END');
    Promise.all(promises).then(function() {
      console.log(fetchContext, 'END', 'PROMISE');
      callback();
    }).catch(function(error) {
      console.log(fetchContext, 'END', 'ERROR', error);
      callback(error);
    });
  });
}

function createStatus(mailbox, callback) {
  fs.readFile(path.join(config.directory, 'status.json'), function(error, data) {
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
      console.log('fetchBatch', 'ERROR', error);
      return finish();
    }
    status.start += 100;
    fs.writeFile(path.join(config.directory, 'status.json'), JSON.stringify(status, null, '  '), (error) => {
      if (error) {
        console.log('fetchBatch', 'ERROR', error);
        return finish();
      }
      if (status.start >= 400) {
        return finish();
      }
      next(status);
    });
  });
}

connection.once('ready', function() {
  console.log('connection', 'READY');
  connection.openBox('[Gmail]/All Mail', true, function(err, mailbox) {
    if (err) {
      console.log('openBox', 'ERROR', err);
      return finish();
    }
    console.log('openBox', 'INFO', inspect(mailbox));
    createStatus(mailbox, (error, status) => {
      if (error) {
        console.log('status', 'ERROR', error);
        return finish();
      }
      next(status);
    });
  });
});

connection.on('alert', function(message) {
  console.log('connection', 'ALERT', message);
});

connection.on('mail', function(numNewMsgs) {
  console.log('connection', 'MAIL', numNewMsgs);
});

connection.on('expunge', function(seqno) {
  console.log('connection', 'EXPUNGE', seqno);
});

connection.on('uidvalidity', function(uidvalidity) {
  console.log('connection', 'UID VALIDITY', uidvalidity);
  finish();
});

connection.on('update', function(seqno, info) {
  console.log('connection', 'UPDATE', seqno, info);
});

connection.on('error', function(error) {
  console.log('connection', 'ERROR', error);
  finish();
});

connection.on('close', function(hadError) {
  console.log('connection', 'CLOSE', hadError);
});

connection.once('end', function() {
  console.log('connection', 'END');
});

connection.connect();
