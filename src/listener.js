'use strict';

var fs = require('fs');
var os = require('os');
var http = require('http');
var _ = require('lodash');
var mongo = require('mongoskin');
var mongoCursorProcessing = require('mongo-cursor-processing');
var mongoOplog = require('mongo-oplog');
var Timestamp = require('bson-timestamp');
var redis = require('redis');
var Processor = require('./processor');
var defaultOptions = require('./default-options');

class Listener {

  constructor(options) {
    this.options = _.merge(_.cloneDeep(defaultOptions), options);
    this.processor = new Processor(options);
    this.processor.setDocGetter((id, done) => {
      this.collection().findOne(id, done);
    });
  }

  log() {
    if (!this.options.logger) {
      return;
    }
    this.options.logger.log.apply(this.options.logger, Array.prototype.slice.call(arguments));
  }

  start() {
    var options = { ns: this.options.mongo.db + '.' + this.options.mongo.collection };
    this.getLastOpTimestamp((err, since) => {
      if (err) {
        this.log(new Error('error reading lastop: ' + err));
      }
      if (since) {
        options.since = since;
      }
      if (options.since) {
        this.log('info', 'resuming from timestamp ' + since);
      } else {
        if (!this.options.skipFullUpsert) {
          this.log('info', 'unable to determine last op, processing entire collection...');
          this.processEntireCollection();
        } else {
          this.log('info', 'unable to determine last op');
        }
      }

      var oplog = this.oplog = options.oplog || mongoOplog(this.options.mongo.uri, options);

      oplog.on('op', (data) => {
        if (data.ns !== options.ns) {
          return;
        }
        this.processor.processOp(data, (err) => {
          if (err) {
            this.log(new Error('error processing op:', data));
            this.log(err);
          }
        });
        if (data && data.ts) {
          this.setLastOpTimestamp(data.ts);
        }
      });

      oplog.on('error', (error) => {
        this.log(error);
      });

      oplog.on('end', () => {
        this.log('warning', 'stream ended');
      });

      oplog.stop(() => {
        this.log('warning', 'server stopped');
      });

      oplog.tail();

      this.startHttpServer();
    });
  }

  setLastOpTimestamp(ts) {
    this.lastOp = ts;
    if (this.options.redisLastOp) {
      if (!this.redisClient) {
        this.redisClient = redis.createClient(this.options.redisLastOp.url);
      }
      this.redisClient.set(this.options.redisLastOp.key, ts.toString());
      return;
    }
    fs.writeFileSync('lastop.json', ts.toString());
  }

  startHttpServer() {
    if (!this.options.http || !this.options.http.port) {
      return;
    }
    var port = this.options.http.port;
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      var data = {
        db: this.options.mongo.db,
        collection: this.options.mongo.collection,
        memoryUsage: process.memoryUsage(),
        loadavg: os.loadavg(),
        lastOp: this.lastOp || 'unknown',
        queueSize: this.processor.processQueue.length
      };
      res.write(JSON.stringify(data, null, 2));
      res.end();
    });
    this.httpServer.listen(port);
    this.log('server listening at http://localhost:' + port);
  }

  getLastOpTimestamp(done) {
    var ts;
    function readFromFile() {
      if (fs.existsSync('lastop.json')) {
        try {
          ts = Timestamp.fromString(fs.readFileSync('lastop.json').toString());
        } catch(err) {
          this.log(new Error('error reading lastop file: ' + err.toString()));
        }
      }
      done(null, ts);
    }

    if (this.options.redisLastOp) {
      try {
        if (!this.redisClient) {
          this.redisClient = redis.createClient(this.options.redisLastOp.url);
          this.redisClient.on('error', (err) => {
            this.log(new Error('Redis client error: ' + err.toString()));
          });
        }
        this.redisClient.get(this.options.redisLastOp.key, (err, value) => {
          if (err) {
            return done(err);
          }
          if (value) {
            try {
              ts = Timestamp.fromString(value.toString());
            } catch(err) {
              this.log(new Error('error reading lastop redis key: ' + err.toString()));
            }
          }
          done(null, ts);
        });
        return;
      } catch(err) {
        return done(err);
      }
    }

    readFromFile.call(this);
  }

  collection() {
    if (!this.readerDb) {
      this.readerDb = mongo.db(this.options.mongo.uriEntireCollectionRead + '/' + this.options.mongo.db);
    }
    return this.readerDb.collection(this.options.mongo.collection);
  }

  processEntireCollection() {
    var db;
    var cursor;
    if (this.options.entireCollectionCursor) {
      cursor = this.options.entireCollectionCursor;
    } else {
      cursor = this.collection().find();
    }
    var count = 0;
    var startTime = new Date().getTime();

    var processor = this.processor;
    function processDocument(doc, done) {
      processor.processDoc(doc, true, (err) => {
        count++;
        done(err);
      });
    }

    var concurrency = this.options.maxBatchSize || 5000;
    mongoCursorProcessing(cursor, processDocument, concurrency, (err) => {
      if (err) {
        this.log(new Error('error processing entire collection: ' + err.toString()));
        process.exit(1);
      }
      var elapsedSeconds = Math.round((new Date().getTime() - startTime)/1000);
      this.log('info', 'entire collection processed (' + count + ' documents, ' +
        Math.floor(elapsedSeconds / 60) + 'm' +
        elapsedSeconds % 60 + 's).');
      if (db) {
        db.close();
      }
    });
  }
}

module.exports = Listener;
